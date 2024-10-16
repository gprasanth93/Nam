DO $$ 
BEGIN
    -- Check if the column length is 50
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'your_table_name' 
        AND column_name = 'your_column_name' 
        AND character_maximum_length = 50
    ) THEN
        -- Alter the column length to 255 if it's currently 50
        EXECUTE 'ALTER TABLE your_table_name 
                 ALTER COLUMN your_column_name 
                 TYPE VARCHAR(255);';
    END IF;
END $$;
