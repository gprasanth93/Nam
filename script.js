SELECT 
    n.nspname AS "Schema",
    c.relname AS "Relation",
    CASE 
        WHEN c.relkind = 'r' THEN 'Table'
        WHEN c.relkind = 'i' THEN 'Index'
        ELSE 'Other'
    END AS "Type",
    (c.relpages * current_setting('block_size')::int) AS "Estimated Size (Bytes)",
    pg_size_pretty(c.relpages * current_setting('block_size')::int) AS "Estimated Size"
FROM 
    pg_class c
JOIN 
    pg_namespace n ON n.oid = c.relnamespace
WHERE 
    c.relkind IN ('r', 'i')  -- 'r' for tables, 'i' for indexes
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY 
    "Estimated Size (Bytes)" DESC;
