"""
cache.py

Postgres-backed CategoryCache with request-level RAM caching.

Design:
- Postgres is the source of truth.
- preload() loads the relevant scope into RAM once per request.
- All normal categorisation operations update RAM immediately.
- save() commits DB changes at the end.

This keeps the old CategoryCache interface while avoiding repeated database
queries during cache checking.
"""

import threading

from checkingName import NEEDS_MANUAL_REVIEW
from psycopg2.extras import execute_values

# Shared across every request handled by this worker process - NOT
# per-request, NOT per-user. The 'global' scope of category_records is
# the same data no matter who's asking or what they're uploading; a
# fresh CategoryCache is constructed on every single call to
# run_cache_tiers()/run_llm_tier(), and preload() used to re-fetch and
# re-build this from Postgres every single time even though the data
# it returns almost never differs from the previous request's. This is
# what makes that a load-once-per-process cache instead: every
# CategoryCache(scope='global') below points its _records_cache at this
# same dict, and write methods (add_record etc.) already mutate
# self._records_cache in place - so once it's loaded, new records
# written during normal use land straight into this shared dict with no
# separate sync step needed, and every subsequent request in this
# process just reuses it instead of round-tripping to Postgres.
#
# The one thing this can't see is the global table being edited
# directly in the database outside the app (e.g. an admin script) -
# that requires a process restart to pick up, which is an acceptable
# tradeoff for cutting a full-table reload out of every request.
_global_records_cache = {}
_global_cache_loaded = False
# gunicorn runs with --threads, so requests share this dict concurrently.
# The lock makes the one-time cold load happen exactly once (a second
# loader's clear() would empty the dict under a request already using it);
# loops over the shared dict iterate a snapshot so a concurrent insert
# can't raise "dictionary changed size during iteration".
_global_cache_lock = threading.Lock()


class CategoryCache:
    def __init__(self, conn, scope, user_id=None):
        if scope not in ("personal", "global"):
            raise ValueError("scope must be 'personal' or 'global'")

        if scope == "personal" and user_id is None:
            raise ValueError("user_id is required when scope='personal'")

        self.conn = conn
        self.scope = scope
        self.user_id = user_id if scope == "personal" else None

        # 'global' points every instance at the SAME shared dict across
        # every request in this process (see comment above). 'personal'
        # keeps a fresh dict every time, same as before - personal
        # history is small and specific to one user, nothing to gain by
        # sharing it.
        if scope == "global":
            self._records_cache = _global_records_cache
        else:
            self._records_cache = {}

        self._preloaded = False
        self.dirty = False
        self._pending_inserts = []
        self._pending_insert_keys = set()
        self._pending_resolves = []
        self._pending_resolve_keys = set()
        self._pending_bulk_updates = {}
        self._pending_deletes = []
    # ---------------------------------------------------------
    # Loading / reading
    # ---------------------------------------------------------

    def preload(self):
        """
        Load all records for this cache scope into RAM.

        scope='personal': queries fresh every time, same as before.

        scope='global': queries Postgres ONCE PER WORKER PROCESS. Every
        subsequent request in this process reuses the same in-memory
        dict (see the module-level comment above) instead of
        re-fetching and re-normalizing the entire shared table again.
        """
        global _global_cache_loaded

        self._pending_inserts.clear()
        self._pending_insert_keys.clear()
        self._pending_resolves.clear()
        self._pending_resolve_keys.clear()
        self._pending_bulk_updates.clear()
        self._pending_deletes.clear()
        self.dirty = False

        if self.scope == "global":
            with _global_cache_lock:
                if not _global_cache_loaded:
                    self._load_records()
                    _global_cache_loaded = True
                    print(
                        f"[CategoryCache] COLD LOAD: fetched global category_records "
                        f"from Postgres ({len(self._records_cache)} descriptions)",
                        flush=True,
                    )
                else:
                    print(
                        f"[CategoryCache] WARM: reusing in-memory global cache "
                        f"({len(self._records_cache)} descriptions) - no DB reload",
                        flush=True,
                    )
        else:
            self._load_records()

        self._preloaded = True

    def _load_records(self):
        self._records_cache.clear()

        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT description, txn_date AS date, amount, category
                FROM category_records
                WHERE scope = %s
                AND user_id IS NOT DISTINCT FROM %s
                """,
                (self.scope, self.user_id),
            )

            for description, date, amount, category in cur.fetchall():
                self._records_cache.setdefault(description, []).append(
                    {
                        "date": date,
                        "amount": amount,
                        "category": category,
                    }
                )

    @staticmethod
    def patch_global_category_rename(old_name, new_name):
        """Live-update every cached global record's category string in
        place, instead of throwing the whole shared cache away and
        paying for a full Postgres reload on the next request that
        needs it. Used right after a category rename has already been
        committed to the DB via raw SQL (see update_category() in
        backend.py) - this just brings the in-memory copy in sync with
        that same change, cheaply, without a round trip.
        """
        for records in list(_global_records_cache.values()):
            for record in list(records):
                if record["category"] == old_name:
                    record["category"] = new_name

    def records_for(self, description):
        """
        Return all records for a description.

        Once preload() has run, this is a pure RAM lookup - including for
        descriptions with NO records at all. That last part matters: most
        new transactions describe something never seen before, and
        without this check, records_for() would silently fall through to
        a live query for every single one of those (since they'd never
        be a key in _records_cache - preload() only populates existing
        descriptions), defeating the entire point of preloading. The
        fallback query path below only runs if preload() genuinely was
        never called for this instance at all.
        """
        if self._preloaded:
            return self._records_cache.get(description, [])

        if description in self._records_cache:
            return self._records_cache[description]

        # fallback safety if preload wasn't called
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT txn_date AS date, amount, category
                FROM category_records
                WHERE description = %s
                AND scope = %s
                AND user_id IS NOT DISTINCT FROM %s
                """,
                (description, self.scope, self.user_id),
            )

            rows = cur.fetchall()

            records = [
                {
                    "date": row[0],
                    "amount": row[1],
                    "category": row[2],
                }
                for row in rows
            ]

            self._records_cache[description] = records

        return records

    def status(self, description):
        records = self.records_for(description)

        if not records:
            return "unknown"

        categories = {r["category"] for r in records}

        if NEEDS_MANUAL_REVIEW in categories:
            return "pending"

        if len(categories) > 1:
            return "ambiguous"

        return "resolved"

    def resolved_category(self, description):
        records = self.records_for(description)

        if not records:
            return None

        categories = {r["category"] for r in records}

        if len(categories) == 1:
            return next(iter(categories))

        return None

    def pending_records(self, description):
        return [
            r
            for r in self.records_for(description)
            if r["category"] == NEEDS_MANUAL_REVIEW
        ]

    # ---------------------------------------------------------
    # Writing
    # ---------------------------------------------------------

    def add_record(self, description, date, amount, category):

        key = (
            description,
            date,
            str(amount),
            category,
            self.scope,
            self.user_id
        )

        # prevent duplicate inserts in same request
        if key in self._pending_insert_keys:
            return

        # prevent duplicate already-existing records
        existing = self._records_cache.get(description, [])

        for record in existing:
            if (
                record["date"] == date
                and str(record["amount"]) == str(amount)
                and record["category"] == category
            ):
                return


        self._records_cache.setdefault(description, []).append(
            {
                "date": date,
                "amount": str(amount),
                "category": category,
            }
        )

        self._pending_inserts.append(key)
        self._pending_insert_keys.add(key)

        self.dirty = True  
        
    def resolve_record(self, description, date, amount, category):

        changed = False

        for record in self._records_cache.get(description, []):

            if (
                record["date"] == date
                and str(record["amount"]) == str(amount)
                and record["category"] == NEEDS_MANUAL_REVIEW
            ):
                record["category"] = category
                resolve_key = (
                    description,
                    date,
                    str(amount),
                    self.scope,
                    self.user_id
                )
                if resolve_key not in self._pending_resolve_keys:
                    self._pending_resolves.append(
                        (
                            category,
                            description,
                            date,
                            str(amount),
                            self.scope,
                            self.user_id,
                        )
                    )
                    self._pending_resolve_keys.add(resolve_key)

                self.dirty = True
                changed = True
                break

        return changed

    def remove_record(self, description, date, amount, category=None):

        records = self._records_cache.get(description, [])

        original_length = len(records)

        self._records_cache[description] = [
            r
            for r in records
            if not (
                r["date"] == date
                and str(r["amount"]) == str(amount)
                and (
                    category is None
                    or r["category"] == category
                )
            )
        ]

        changed = len(self._records_cache[description]) < original_length

        if changed:

            self._pending_deletes.append(
                (
                    description,
                    date,
                    str(amount),
                    category,
                    self.scope,
                    self.user_id,
                )
            )

            self.dirty = True

        return changed

    def set_all_records_category(self, description, category):

        changed = 0

        for record in self._records_cache.get(description, []):

            if record["category"] != category:

                record["category"] = category
                changed += 1

        if changed:

            self._pending_bulk_updates[
                ("description", description, self.scope, self.user_id)
            ] = category

            self.dirty = True

        return changed
    
    def rename_category_everywhere(self, old_name, new_name):

        changed = 0

        for records in list(self._records_cache.values()):

            for record in list(records):

                if record["category"] == old_name:
                    record["category"] = new_name
                    changed += 1


        if changed:

            self._pending_bulk_updates[
                ("rename", old_name, self.scope, self.user_id)
            ] = new_name

            self.dirty = True

        return changed

    # ---------------------------------------------------------
    # Bulk helpers
    # ---------------------------------------------------------

    def resolved_descriptions(self):
        resolved = {}

        for description, records in list(self._records_cache.items()):
            categories = {r["category"] for r in list(records)}

            if (
                len(categories) == 1
                and NEEDS_MANUAL_REVIEW not in categories
            ):
                resolved[description] = next(iter(categories))

        return resolved

    def all_descriptions(self):
        return list(self._records_cache.keys())

    def __len__(self):
        return len(self._records_cache)

    def save(self):

        if not self.dirty:
            return

        with self.conn.cursor() as cur:

            # INSERTS
            #
            # execute_values, not executemany - psycopg2's executemany()
            # is a common trap: despite the name, it does NOT batch
            # multiple rows into fewer network round trips by default,
            # it just loops and calls execute() once per row internally.
            # Same cost profile as a manual Python for-loop. This
            # scales directly with CACHE_CHUNK_SIZE (one insert per
            # transaction that needed a NEEDS_MANUAL_REVIEW placeholder
            # written), so at a large enough chunk size this was the
            # same class of bug that caused the WORKER TIMEOUT fixed in
            # update_transaction_categories (shared.py) - just not yet
            # the one that had actually crashed.
            if self._pending_inserts:
                execute_values(
                    cur,
                    """
                    INSERT INTO category_records
                    (description, txn_date, amount, category, scope, user_id)
                    VALUES %s
                    """,
                    self._pending_inserts,
                    template="(%s,%s,%s,%s,%s,%s)",
                )


            # RESOLVE SINGLE RECORDS
            if self._pending_resolves:
                # LIMIT 1 via subquery, deliberately - resolve_record()
                # above only ever updates ONE record in RAM (it breaks
                # after the first match). Without this, if two genuinely
                # identical transactions exist (same description, date,
                # amount - which can legitimately happen), a plain WHERE
                # clause with no LIMIT would resolve BOTH of them in
                # Postgres while RAM only marked one as resolved - RAM
                # and the database would disagree the moment the next
                # preload() happens. This keeps them in agreement.
                #
                # Batched via execute_values rather than executemany -
                # same reasoning as INSERTS above. The correlated
                # subquery still runs ONCE PER VALUES ROW (referencing
                # that row's own v.* columns), so the "only ever resolve
                # one matching record" guarantee is exactly as strict as
                # before - this changes how many round trips the whole
                # batch costs, not what any individual row's update is
                # allowed to match.
                execute_values(
                    cur,
                    """
                    UPDATE category_records AS t
                    SET category = v.new_category
                    FROM (VALUES %s) AS v(new_category, description, txn_date, amount, category, scope, user_id)
                    WHERE t.id = (
                        SELECT id FROM category_records
                        WHERE description = v.description
                        AND txn_date = v.txn_date
                        AND amount = v.amount
                        AND category = v.category
                        AND scope = v.scope
                        AND user_id IS NOT DISTINCT FROM v.user_id
                        LIMIT 1
                    )
                    """,
                    [
                        (
                            category,
                            desc,
                            date,
                            amount,
                            NEEDS_MANUAL_REVIEW,
                            scope,
                            user_id
                        )
                        for category, desc, date, amount, scope, user_id
                        in self._pending_resolves
                    ],
                    template="(%s,%s,%s,%s,%s,%s,%s)",
                )


            # BULK UPDATES
            for key, new_category in self._pending_bulk_updates.items():

                if key[0] == "description":

                    _, description, scope, user_id = key

                    cur.execute(
                        """
                        UPDATE category_records
                        SET category = %s
                        WHERE description = %s
                        AND scope = %s
                        AND user_id IS NOT DISTINCT FROM %s
                        """,
                        (
                            new_category,
                            description,
                            scope,
                            user_id
                        )
                    )


                elif key[0] == "rename":

                    _, old_name, scope, user_id = key

                    cur.execute(
                        """
                        UPDATE category_records
                        SET category = %s
                        WHERE category = %s
                        AND scope = %s
                        AND user_id IS NOT DISTINCT FROM %s
                        """,
                        (
                            new_category,
                            old_name,
                            scope,
                            user_id
                        )
                    )


            # DELETES
            # This used to be just a comment ("same idea as before...")
            # with no actual DELETE ever executed - remove_record()
            # updated RAM and queued an entry here, but save() never
            # read _pending_deletes at all, so the record silently came
            # right back on the next preload(). This matters a lot in
            # practice: it's exactly the mechanism a personal resolution
            # relies on to remove a global NEEDS_MANUAL_REVIEW placeholder
            # once someone's answered it - without this actually running,
            # that placeholder would never leave the database and the
            # description would stay stuck "pending" globally forever.
            #
            # category can legitimately be None here (remove_record's
            # "match regardless of category" mode), so the category
            # filter is conditional rather than a plain equality check.
            if self._pending_deletes:
                # Batched via execute_values + DELETE...USING(VALUES...)
                # - same reasoning as INSERTS/RESOLVES above. category
                # can legitimately be NULL per row (remove_record's
                # "match regardless of category" mode) - v.category IS
                # NULL is evaluated per VALUES row, same conditional
                # logic as the original per-row query, just batched.
                execute_values(
                    cur,
                    """
                    DELETE FROM category_records AS t
                    USING (VALUES %s) AS v(description, txn_date, amount, category, scope, user_id)
                    WHERE t.description = v.description
                    AND t.txn_date = v.txn_date
                    AND t.amount = v.amount
                    AND (v.category IS NULL OR t.category = v.category)
                    AND t.scope = v.scope
                    AND t.user_id IS NOT DISTINCT FROM v.user_id
                    """,
                    [
                        (description, date, amount, category, scope, user_id)
                        for description, date, amount, category, scope, user_id
                        in self._pending_deletes
                    ],
                    template="(%s,%s,%s,%s,%s,%s)",
                )


        self._pending_inserts.clear()
        self._pending_insert_keys.clear()
        self._pending_resolves.clear()
        self._pending_resolve_keys.clear()
        self._pending_bulk_updates.clear()
        self._pending_deletes.clear()

        self.conn.commit()
        self.dirty = False