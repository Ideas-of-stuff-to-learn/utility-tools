"""
matching/merchants/storage.py

Reading from and writing to the merchants table in Postgres, keeping
the process-level cache (cache_state.py) in sync with every write.
"""

from psycopg2.extras import execute_values

from .normalise import normalise_for_matching
from .cache_state import (
    get_global_merchants_cache,
    set_global_merchants_cache,
    invalidate_merchant_automaton,
)


def load_merchants(conn) -> dict:
    """Load the full merchant dictionary from the merchants table.
    Returns an empty dict if the table has no rows yet.

    Cached at the process level - only actually queries Postgres and
    re-normalises every name once per worker process; every call after
    that reuses the same dict. add_merchant() keeps this in sync when
    new merchants are learned, so it never goes stale during normal
    operation.
    """
    existing = get_global_merchants_cache()
    if existing is not None:
        print(
            f"[load_merchants] WARM: reusing in-memory merchants cache "
            f"({len(existing)} merchants) - no DB reload",
            flush=True,
        )
        return existing

    with conn.cursor() as cur:
        cur.execute("SELECT normalized_name, category FROM merchants")
        merchants = dict(cur.fetchall())
        normalised_merchants = {
            normalise_for_matching(name): category
            for name, category in merchants.items()
        }
    set_global_merchants_cache(normalised_merchants)
    print(
        f"[load_merchants] COLD LOAD: fetched merchants table from "
        f"Postgres ({len(normalised_merchants)} merchants)",
        flush=True,
    )
    return normalised_merchants


def add_merchant(conn, normalised_name: str, category: str) -> None:
    """Insert or update a single merchant entry and commit immediately.
    Merchant-learning is a small, standalone write - not worth batching
    into the same transaction as the surrounding categorisation work,
    since it should persist even if something later in the request fails.

    Also updates the process-level cache in place, so the newly learned
    merchant is usable immediately by this same process without waiting
    for a reload.

    Kept for any single-merchant call site (e.g. an admin CLI action
    adding one merchant by hand) - run_llm_tier (categorise/llm_tier)
    uses add_merchants_batch() below instead, for the same "many
    individual round trips" reason update_transaction_categories and
    CategoryCache.save() did.
    """
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO merchants (normalized_name, category)
               VALUES (%s, %s)
               ON CONFLICT (normalized_name) DO UPDATE SET category = EXCLUDED.category""",
            (normalised_name, category),
        )
    conn.commit()

    existing = get_global_merchants_cache()
    if existing is not None:
        existing[normalised_name] = category
    invalidate_merchant_automaton()


def add_merchants_batch(conn, pairs) -> None:
    """Batched replacement for calling add_merchant() once per newly-
    learned merchant. `pairs` is a list of (normalised_name, category)
    tuples. One execute_values call + one commit for the WHOLE list,
    instead of one round trip per merchant - same fix, same reasoning,
    as update_transaction_categories (shared.py) and CategoryCache.save()
    (cache.py): a from-scratch categorisation run can learn hundreds of
    merchants in one request, and add_merchant()'s per-item commit is
    exactly the kind of cost that scales badly with volume.

    Deliberately called once per GEMINI BATCH inside run_llm_tier, not
    once for the entire request - this keeps most of add_merchant()'s
    original "persist even if something later fails" property: if the
    request dies partway through a large multi-batch run, every
    already-completed batch's merchants are still safely committed:
    only the batch that was in-flight at the moment of failure could
    lose its newly-learned merchants, not everything learned so far.
    """
    if not pairs:
        return

    with conn.cursor() as cur:
        execute_values(
            cur,
            """INSERT INTO merchants (normalized_name, category)
               VALUES %s
               ON CONFLICT (normalized_name) DO UPDATE SET category = EXCLUDED.category""",
            pairs,
            template="(%s, %s)",
        )
    conn.commit()

    existing = get_global_merchants_cache()
    if existing is not None:
        for normalised_name, category in pairs:
            existing[normalised_name] = category
    invalidate_merchant_automaton()


def patch_merchants_category_rename(old_name, new_name):
    """Live-update every cached merchant's category string in place,
    instead of discarding the whole cache and paying for a full
    Postgres reload on the next request that needs it. Used right
    after a category rename has already been committed to the DB via
    raw SQL (see update_category() in backend.py) - this brings the
    in-memory copy in sync with that same change, cheaply, without a
    round trip.
    """
    existing = get_global_merchants_cache()
    if existing is None:
        return
    for merchant_name, category in list(existing.items()):
        if category == old_name:
            existing[merchant_name] = new_name