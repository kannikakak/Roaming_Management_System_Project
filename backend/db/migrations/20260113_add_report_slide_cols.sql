ALTER TABLE report_slides
  ADD COLUMN selected_cols JSON NULL,
  ADD COLUMN file_id INT NULL,
  ADD COLUMN file_name VARCHAR(255) NULL,
  ADD CONSTRAINT fk_report_slides_file_id
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL;
