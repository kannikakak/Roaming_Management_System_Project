-- -- Create Database
-- CREATE DATABASE IF NOT EXISTS roaming_interconnect_system;
-- USE roaming_interconnect_system;

-- -- Create Users Table
-- CREATE TABLE IF NOT EXISTS users (
--     id INT AUTO_INCREMENT PRIMARY KEY,
--     username VARCHAR(255) UNIQUE NOT NULL,
--     email VARCHAR(255) UNIQUE NOT NULL,
--     password VARCHAR(255) NOT NULL,
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
-- );

-- -- Create Transactions Table
-- CREATE TABLE IF NOT EXISTS transactions (
--     id INT AUTO_INCREMENT PRIMARY KEY,
--     user_id INT NOT NULL,
--     transaction_type VARCHAR(50) NOT NULL,
--     amount DECIMAL(10, 2) NOT NULL,
--     status VARCHAR(50) DEFAULT 'pending',
--     description VARCHAR(255),
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
-- );

-- -- Create Roaming Records Table
-- CREATE TABLE IF NOT EXISTS roaming_records (
--     id INT AUTO_INCREMENT PRIMARY KEY,
--     user_id INT NOT NULL,
--     country VARCHAR(100),
--     operator VARCHAR(100),
--     data_used DECIMAL(10, 2),
--     cost DECIMAL(10, 2),
--     period_start DATE,
--     period_end DATE,
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
-- );

-- -- Create Interconnect Logs Table
-- CREATE TABLE IF NOT EXISTS interconnect_logs (
--     id INT AUTO_INCREMENT PRIMARY KEY,
--     from_operator VARCHAR(100),
--     to_operator VARCHAR(100),
--     duration INT,
--     cost DECIMAL(10, 2),
--     timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- -- Insert Sample Data
-- INSERT INTO users (username, email, password) VALUES
-- ('admin', 'admin@example.com', 'password123'),
-- ('user1', 'user1@example.com', 'password123');

-- INSERT INTO transactions (user_id, transaction_type, amount, status, description) VALUES
-- (1, 'roaming', 50.00, 'completed', 'Roaming charge - Thailand'),
-- (1, 'interconnect', 25.00, 'completed', 'Interconnect charge - Viettel'),
-- (2, 'roaming', 75.00, 'pending', 'Roaming charge - Singapore');
