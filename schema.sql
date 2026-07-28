-- Create Database
CREATE DATABASE IF NOT EXISTS gkpi_pekanbaru;
USE gkpi_pekanbaru;

-- Table `sektor`
CREATE TABLE IF NOT EXISTS sektor (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(100) NOT NULL UNIQUE
);

-- Table `jemaat`
CREATE TABLE IF NOT EXISTS jemaat (
    id VARCHAR(36) PRIMARY KEY,
    no_jemaat VARCHAR(100) NOT NULL,
    nama VARCHAR(255) NOT NULL,
    status_keluarga VARCHAR(100) NULL,
    jenis_kelamin ENUM('Laki-laki', 'Perempuan') NOT NULL,
    alamat TEXT NULL,
    sektor_nama VARCHAR(100) NOT NULL, -- Menyimpan nama sektor langsung agar sinkron dengan app.js
    tanggal_lahir DATE NULL,
    tanggal_baptis DATE NULL,
    tanggal_sidi DATE NULL,
    tanggal_nikah DATE NULL,
    family_id VARCHAR(100) NOT NULL,
    entered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status_keanggotaan ENUM('Aktif', 'Pindah', 'Meninggal') DEFAULT 'Aktif',
    tanggal_keluar DATE NULL,
    catatan_keluar TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert Default Sectors
INSERT IGNORE INTO sektor (nama) VALUES
('PANAM 1'),
('PANAM 2'),
('SELATAN 1'),
('SELATAN 2'),
('SELATAN 3'),
('SIDOMULYO'),
('BUDIUTOMO'),
('BARAT'),
('TAMPAN'),
('KHUSUS'),
('JERUSALEM');
