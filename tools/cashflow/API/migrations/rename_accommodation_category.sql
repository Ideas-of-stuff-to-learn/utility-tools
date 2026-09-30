-- Fixes the spelling of the seeded category "Accomodation & Bills" -> "Accommodation & Bills".
--
-- Does exactly what PATCH /categories does for a rename (routes/categories.py):
-- categories, category_records, merchants and transactions, in ONE transaction.
-- Safe to run twice: it only acts if the old name exists and the new one doesn't.
--
-- RUN ORDER MATTERS:
--   1. Run this (Supabase SQL editor) -- or, preferably, rename the category in the admin
--      panel, which also refreshes the running server's in-memory caches.
--   2. If you ran THIS SCRIPT instead of the admin panel, restart the Render service so its
--      cached category_records/merchants stop serving the old name.
--   3. Only then run schema.sql again (its seed row now uses the new spelling; running it
--      BEFORE the rename would insert a second, duplicate category).
--
-- Side effect: anyone with a saved custom chart stack order ("remember order") still has the
-- old name in it, so that one category disappears from their chart until they reset the order.
-- Their transactions and totals are unaffected.

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM categories WHERE name = 'Accomodation & Bills')
       AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Accommodation & Bills') THEN
        UPDATE categories       SET name     = 'Accommodation & Bills' WHERE name     = 'Accomodation & Bills';
        UPDATE category_records SET category = 'Accommodation & Bills' WHERE category = 'Accomodation & Bills';
        UPDATE merchants        SET category = 'Accommodation & Bills' WHERE category = 'Accomodation & Bills';
        UPDATE transactions     SET category = 'Accommodation & Bills' WHERE category = 'Accomodation & Bills';
        RAISE NOTICE 'Renamed Accomodation & Bills -> Accommodation & Bills';
    ELSE
        RAISE NOTICE 'Nothing to do (already renamed, or the old name does not exist)';
    END IF;
END $$;

COMMIT;
