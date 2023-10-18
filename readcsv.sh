#!/bin/bash

# Check for the correct number of arguments
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <input_file> <column_name>"
  exit 1
fi

input_file="$1"
column_name="$2"

# Use awk to process the file
awk -v colname="$column_name" 'BEGIN {FS="|"; OFS="|"} {
  if (NR == 1) {
    for (i=1; i<=NF; i++) {
      if ($i == colname) {
        col_num = i
      }
    }
    if (col_num == 0) {
      print "Column not found: " colname
      exit 1
    }
  } else {
    gsub("\n", " ", $col_num)
  }
  print
}' "$input_file"