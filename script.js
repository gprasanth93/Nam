SELECT
    s.schemaname AS "Schema Name",
    s.relname AS "Table Name",
    pg_size_pretty(pg_total_relation_size(s.relid)) AS "Total Relation Size",
    pg_size_pretty(pg_table_size(s.relid)) AS "Table Size",
    pg_size_pretty(pg_indexes_size(s.relid)) AS "Index Size",
    pg_size_pretty(pg_total_relation_size(s.relid) - pg_relation_size(s.relid)) AS "Bloat Size",
    stio.heap_blks_read AS "Disk Hits",
    stio.heap_blks_hit AS "Cache Hits",
    CASE 
        WHEN (stio.heap_blks_read + stio.heap_blks_hit) = 0 THEN 0 
        ELSE ROUND((stio.heap_blks_read::numeric / (stio.heap_blks_read + stio.heap_blks_hit)::numeric) * 100.0, 2) 
    END AS "% Disk Hits",
    CASE 
        WHEN (stio.heap_blks_read + stio.heap_blks_hit) = 0 THEN 0 
        ELSE ROUND((stio.heap_blks_hit::numeric / (stio.heap_blks_read + stio.heap_blks_hit)::numeric) * 100.0, 2) 
    END AS "% Cache Hits",
    (stio.heap_blks_read + stio.heap_blks_hit) AS "Total Hits",
    s.n_live_tup AS "Row Estimate",
    COALESCE(s.n_dead_tup, 0) AS "Rows Changed",
    COALESCE(s.seq_scan, 0) AS "Seq Scan",
    COALESCE(s.idx_scan, 0) AS "Index Scan",
    COALESCE(s.idx_tup_fetch, 0) AS "Index Fetch",
    CASE 
        WHEN (s.seq_scan + s.idx_scan) = 0 THEN 0 
        ELSE ROUND((s.idx_scan::numeric / (s.seq_scan + s.idx_scan)::numeric) * 100.0, 2) 
    END AS "% Index Usage",
    COALESCE(to_char(s.last_vacuum, 'DD Mon YYYY HH12:MI:SS TZ'), 'Never') AS "Last Manual Vacuum",
    COALESCE(to_char(s.last_analyze, 'DD Mon YYYY HH12:MI:SS TZ'), 'Never') AS "Last Manual Analyze",
    COALESCE(to_char(s.last_autovacuum, 'DD Mon YYYY HH12:MI:SS TZ'), 'Never') AS "Last Auto Vacuum",
    COALESCE(to_char(s.last_autoanalyze, 'DD Mon YYYY HH12:MI:SS TZ'), 'Never') AS "Last Auto Analyze",
    COALESCE(s.vacuum_count, 0) AS "Manual Vacuum Count",
    COALESCE(s.analyze_count, 0) AS "Manual Analyze Count",
    COALESCE(s.autovacuum_count, 0) AS "Auto Vacuum Count",
    COALESCE(s.autoanalyze_count, 0) AS "Auto Analyze Count"
FROM
    pg_stat_user_tables s
LEFT JOIN
    pg_statio_user_tables stio ON stio.relid = s.relid
ORDER BY
    pg_total_relation_size(s.relid) DESC;
