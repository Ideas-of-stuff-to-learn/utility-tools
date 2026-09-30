-- Fixes the spelling of the seeded category "Accomodation & Bills" -> "Accommodation & Bills"
-- everywhere the name is stored. Paste the whole file into the Supabase SQL editor and run it.
--
-- PART 1  the category itself. Does exactly what PATCH /categories does for a rename
--         (routes/categories.py): categories, category_records, merchants, transactions,
--         in one transaction. Skipped automatically if you already renamed it in the admin
--         panel (or if the old name doesn't exist), so it is safe to run twice.
-- PART 2  every user's saved preferences (users.preferences JSON). The app's own rename does
--         NOT touch these, so without this a user's custom chart order still lists the old
--         name and that category vanishes from their chart:
--           stackOrder  -> array of category names (the "remember order" custom stack order)
--           mrPicks     -> pending manual-review picks, each with a "category"
--         Order of the arrays is preserved; other keys are untouched. Idempotent, and worth
--         running even if PART 1 was done through the admin panel.
--
-- AFTER RUNNING
--   * If PART 1 changed rows (you'll see a NOTICE saying so), RESTART the Render service:
--     the server keeps category_records and merchants cached in memory and would keep serving
--     the old name until it restarts. (The admin panel rename patches those caches itself.)
--   * Browsers refresh on their own: the change alters the server data fingerprint, so each
--     user's next visit refetches categories and transactions in the background.
--   * Do NOT run schema.sql before this: its seed row now uses the new spelling and would
--     insert a duplicate category next to the old one.
--   * Audit-log text that mentions the old name is history and is left as it is.
--
-- To check afterwards (should return 0 rows each):
--   SELECT name FROM categories WHERE name = 'Accomodation & Bills';
--   SELECT 1 FROM transactions WHERE category = 'Accomodation & Bills' LIMIT 1;
--   SELECT id FROM users WHERE preferences::text LIKE '%Accomodation%';

BEGIN;

-- PART 1: the category and everything that stores it by name
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM categories WHERE name = 'Accomodation & Bills')
       AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Accommodation & Bills') THEN
        UPDATE categories       SET name     = 'Accommodation & Bills' WHERE name     = 'Accomodation & Bills';
        UPDATE category_records SET category = 'Accommodation & Bills' WHERE category = 'Accomodation & Bills';
        UPDATE merchants        SET category = 'Accommodation & Bills' WHERE category = 'Accomodation & Bills';
        UPDATE transactions     SET category = 'Accommodation & Bills' WHERE category = 'Accomodation & Bills';
        RAISE NOTICE 'PART 1: renamed Accomodation & Bills -> Accommodation & Bills (restart Render afterwards)';
    ELSE
        RAISE NOTICE 'PART 1: nothing to do (already renamed, or the old name does not exist)';
    END IF;
END $$;

-- PART 2a: saved custom chart order (stackOrder = JSON array of names)
UPDATE users
SET preferences = jsonb_set(
    preferences,
    '{stackOrder}',
    (SELECT COALESCE(jsonb_agg(
                CASE WHEN t.e = to_jsonb('Accomodation & Bills'::text)
                     THEN to_jsonb('Accommodation & Bills'::text)
                     ELSE t.e END
                ORDER BY t.ord), '[]'::jsonb)
       FROM jsonb_array_elements(preferences -> 'stackOrder') WITH ORDINALITY AS t(e, ord))
)
WHERE jsonb_typeof(preferences -> 'stackOrder') = 'array'
  AND preferences -> 'stackOrder' @> to_jsonb('Accomodation & Bills'::text);

-- PART 2b: pending manual-review picks (mrPicks = JSON array of {description, date, amount, category})
UPDATE users
SET preferences = jsonb_set(
    preferences,
    '{mrPicks}',
    (SELECT COALESCE(jsonb_agg(
                CASE WHEN t.e ->> 'category' = 'Accomodation & Bills'
                     THEN jsonb_set(t.e, '{category}', to_jsonb('Accommodation & Bills'::text))
                     ELSE t.e END
                ORDER BY t.ord), '[]'::jsonb)
       FROM jsonb_array_elements(preferences -> 'mrPicks') WITH ORDINALITY AS t(e, ord))
)
WHERE jsonb_typeof(preferences -> 'mrPicks') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(preferences -> 'mrPicks') AS x
              WHERE x ->> 'category' = 'Accomodation & Bills');

COMMIT;
