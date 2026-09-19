-- =====================================================================
-- SeatRush: Normalized MySQL Database Schema (3NF)
-- High-Throughput IRCTC Tatkal Flash-Sale Ticketing Engine
-- =====================================================================

-- 1. Drop existing tables in reverse dependency order
DROP TABLE IF EXISTS passengers;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS inventory_quotas;
DROP TABLE IF EXISTS train_schedules;
DROP TABLE IF EXISTS train_coaches;
DROP TABLE IF EXISTS trains;
DROP TABLE IF EXISTS quotas;
DROP TABLE IF EXISTS travel_classes;
DROP TABLE IF EXISTS stations;

-- =====================================================================
-- 2. Master Tables
-- =====================================================================

-- Stations Registry (Unique station code, city, state)
CREATE TABLE stations (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    city VARCHAR(50) NOT NULL,
    state VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Travel Classes (AC 3 Tier, AC 2 Tier, AC 1st, Sleeper)
CREATE TABLE travel_classes (
    code VARCHAR(5) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    base_fare DECIMAL(10, 2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Booking Quotas (Tatkal, General, Premium Tatkal, Ladies)
CREATE TABLE quotas (
    code VARCHAR(5) PRIMARY KEY,
    name VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Master Trains
CREATE TABLE trains (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_number VARCHAR(10) NOT NULL UNIQUE,
    train_name VARCHAR(100) NOT NULL,
    train_type VARCHAR(50) DEFAULT 'SUPERFAST',
    source_station_code VARCHAR(10) NOT NULL,
    dest_station_code VARCHAR(10) NOT NULL,
    runs_on VARCHAR(20) DEFAULT 'M T W T F S S',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_station_code) REFERENCES stations(code),
    FOREIGN KEY (dest_station_code) REFERENCES stations(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Physical Coach Layout per Train
CREATE TABLE train_coaches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_id INT NOT NULL,
    coach_code VARCHAR(10) NOT NULL,
    class_code VARCHAR(5) NOT NULL,
    total_berths INT NOT NULL,
    sequence_in_rake INT NOT NULL,
    FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE,
    FOREIGN KEY (class_code) REFERENCES travel_classes(code),
    UNIQUE KEY uq_train_coach (train_id, coach_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Multi-Stop Intermediate Route Stops
CREATE TABLE train_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_id INT NOT NULL,
    station_code VARCHAR(10) NOT NULL,
    stop_sequence INT NOT NULL,
    arrival_time TIME NULL,
    departure_time TIME NULL,
    day_offset TINYINT DEFAULT 0,
    distance_from_origin_km INT NOT NULL,
    FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE,
    FOREIGN KEY (station_code) REFERENCES stations(code),
    UNIQUE KEY uq_train_seq (train_id, stop_sequence),
    UNIQUE KEY uq_train_station (train_id, station_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 3. Inventory & Booking Transaction Tables
-- =====================================================================

-- Aggregate Seat Quota Inventory & Waitlist Balance
CREATE TABLE inventory_quotas (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    train_id INT NOT NULL,
    journey_date DATE NOT NULL,
    class_code VARCHAR(5) NOT NULL,
    quota_code VARCHAR(5) NOT NULL,
    total_seats INT NOT NULL DEFAULT 10,
    available_seats INT NOT NULL DEFAULT 10,
    waitlist_limit INT NOT NULL DEFAULT 50,
    waitlist_count INT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE,
    FOREIGN KEY (class_code) REFERENCES travel_classes(code),
    FOREIGN KEY (quota_code) REFERENCES quotas(code),
    UNIQUE KEY uq_train_inventory (train_id, journey_date, class_code, quota_code),
    INDEX idx_inventory_lookup (train_id, journey_date, class_code, quota_code, available_seats)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Master Bookings (PNR & Ticket Header)
CREATE TABLE bookings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pnr_number VARCHAR(10) NOT NULL UNIQUE,
    train_id INT NOT NULL,
    journey_date DATE NOT NULL,
    from_station_code VARCHAR(10) NOT NULL,
    to_station_code VARCHAR(10) NOT NULL,
    class_code VARCHAR(5) NOT NULL,
    quota_code VARCHAR(5) NOT NULL,
    contact_email VARCHAR(100),
    contact_phone VARCHAR(20),
    total_passengers TINYINT NOT NULL DEFAULT 1,
    total_fare DECIMAL(10, 2) NOT NULL,
    booking_status ENUM('CONFIRMED', 'WAITLISTED', 'CANCELLED', 'FAILED') NOT NULL,
    booked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (train_id) REFERENCES trains(id),
    FOREIGN KEY (from_station_code) REFERENCES stations(code),
    FOREIGN KEY (to_station_code) REFERENCES stations(code),
    FOREIGN KEY (class_code) REFERENCES travel_classes(code),
    FOREIGN KEY (quota_code) REFERENCES quotas(code),
    INDEX idx_pnr (pnr_number),
    INDEX idx_journey (train_id, journey_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Individual Passengers per Booking (1 to 4 Passengers)
CREATE TABLE passengers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    passenger_name VARCHAR(100) NOT NULL,
    age TINYINT NOT NULL,
    gender ENUM('M', 'F', 'O') NOT NULL,
    berth_preference ENUM('NO_PREF', 'LOWER', 'MIDDLE', 'UPPER', 'SIDE_LOWER', 'SIDE_UPPER') DEFAULT 'NO_PREF',
    allocated_coach VARCHAR(10) NULL,
    allocated_berth_number INT NULL,
    allocated_berth_type VARCHAR(20) NULL,
    current_status VARCHAR(20) NOT NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_booking_passengers (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =====================================================================
-- 4. Sample Seed Data
-- =====================================================================

-- Stations
INSERT INTO stations (code, name, city, state) VALUES
('NDLS', 'New Delhi', 'New Delhi', 'Delhi'),
('AGC',  'Agra Cantt', 'Agra', 'Uttar Pradesh'),
('GWL',  'Gwalior Jn', 'Gwalior', 'Madhya Pradesh'),
('KOTA', 'Kota Jn', 'Kota', 'Rajasthan'),
('CNB',  'Kanpur Central', 'Kanpur', 'Uttar Pradesh'),
('PRYJ', 'Prayagraj Jn', 'Prayagraj', 'Uttar Pradesh'),
('DDU',  'Pt Deen Dayal Upadhyaya Jn', 'Mughalsarai', 'Uttar Pradesh'),
('BPL',  'Bhopal Jn', 'Bhopal', 'Madhya Pradesh'),
('NGP',  'Nagpur Jn', 'Nagpur', 'Maharashtra'),
('ADI',  'Ahmedabad Jn', 'Ahmedabad', 'Gujarat'),
('BRC',  'Vadodara Jn', 'Vadodara', 'Gujarat'),
('ST',   'Surat', 'Surat', 'Gujarat'),
('MMCT', 'Mumbai Central', 'Mumbai', 'Maharashtra'),
('GAYA', 'Gaya Jn', 'Gaya', 'Bihar'),
('HWH',  'Howrah Jn', 'Kolkata', 'West Bengal'),
('BZA',  'Vijayawada Jn', 'Vijayawada', 'Andhra Pradesh'),
('MAS',  'MGR Chennai Central', 'Chennai', 'Tamil Nadu'),
('SBC',  'KSR Bengaluru', 'Bengaluru', 'Karnataka');

-- Travel Classes
INSERT INTO travel_classes (code, name, base_fare) VALUES
('3A', 'AC 3 Tier (3A)', 1740.00),
('2A', 'AC 2 Tier (2A)', 2490.00),
('1A', 'AC First Class (1A)', 4120.00),
('SL', 'Sleeper Class (SL)', 685.00);

-- Quotas
INSERT INTO quotas (code, name) VALUES
('TQ', 'TATKAL'),
('GN', 'GENERAL'),
('PT', 'PREMIUM TATKAL'),
('LD', 'LADIES');

-- Trains
INSERT INTO trains (id, train_number, train_name, train_type, source_station_code, dest_station_code, runs_on) VALUES
(1, '12952', 'TEJAS RAJ EXPRESS',    'RAJDHANI SUPERFAST', 'NDLS', 'MMCT', 'M T W T F S S'),
(2, '12302', 'HOWRAH RAJDHANI',      'RAJDHANI SUPERFAST', 'NDLS', 'HWH',  'M T W T F S S'),
(3, '12622', 'TAMIL NADU EXPRESS',   'SUPERFAST EXPRESS',  'NDLS', 'MAS',  'M T W T F S S');

-- Train Coaches (Physical Rake Composition)
INSERT INTO train_coaches (train_id, coach_code, class_code, total_berths, sequence_in_rake) VALUES
-- 12952 Tejas Rajdhani
(1, 'H1', '1A', 24, 1),
(1, 'A1', '2A', 54, 2),
(1, 'A2', '2A', 54, 3),
(1, 'B1', '3A', 72, 4),
(1, 'B2', '3A', 72, 5),
(1, 'B3', '3A', 72, 6),
(1, 'B4', '3A', 72, 7),
(1, 'B5', '3A', 72, 8),
-- 12302 Howrah Rajdhani
(2, 'H1', '1A', 24, 1),
(2, 'A1', '2A', 54, 2),
(2, 'B1', '3A', 72, 3),
(2, 'B2', '3A', 72, 4),
(2, 'B3', '3A', 72, 5),
-- 12622 Tamil Nadu Express
(3, 'A1', '2A', 54, 1),
(3, 'B1', '3A', 72, 2),
(3, 'B2', '3A', 72, 3),
(3, 'S1', 'SL', 72, 4),
(3, 'S2', 'SL', 72, 5),
(3, 'S3', 'SL', 72, 6),
(3, 'S4', 'SL', 72, 7);

-- Intermediate Route Schedules
-- Train 1: 12952 (NDLS -> MMCT)
INSERT INTO train_schedules (train_id, station_code, stop_sequence, arrival_time, departure_time, day_offset, distance_from_origin_km) VALUES
(1, 'NDLS', 1, NULL,       '16:55:00', 0, 0),
(1, 'KOTA', 2, '21:30:00', '21:40:00', 0, 465),
(1, 'BRC',  3, '03:40:00', '03:50:00', 1, 992),
(1, 'ST',   4, '05:13:00', '05:18:00', 1, 1122),
(1, 'MMCT', 5, '08:35:00', NULL,       1, 1384);

-- Train 2: 12302 (NDLS -> HWH)
INSERT INTO train_schedules (train_id, station_code, stop_sequence, arrival_time, departure_time, day_offset, distance_from_origin_km) VALUES
(2, 'NDLS', 1, NULL,       '16:50:00', 0, 0),
(2, 'CNB',  2, '21:32:00', '21:37:00', 0, 440),
(2, 'PRYJ', 3, '23:43:00', '23:45:00', 0, 635),
(2, 'DDU',  4, '01:42:00', '01:52:00', 1, 787),
(2, 'GAYA', 5, '04:10:00', '04:13:00', 1, 992),
(2, 'HWH',  6, '09:55:00', NULL,       1, 1451);

-- Train 3: 12622 (NDLS -> MAS)
INSERT INTO train_schedules (train_id, station_code, stop_sequence, arrival_time, departure_time, day_offset, distance_from_origin_km) VALUES
(3, 'NDLS', 1, NULL,       '21:05:00', 0, 0),
(3, 'AGC',  2, '23:25:00', '23:27:00', 0, 195),
(3, 'GWL',  3, '01:13:00', '01:15:00', 1, 313),
(3, 'BPL',  4, '06:45:00', '06:55:00', 1, 703),
(3, 'NGP',  5, '13:05:00', '13:10:00', 1, 1093),
(3, 'BZA',  6, '00:05:00', '00:15:00', 2, 1754),
(3, 'MAS',  7, '06:35:00', NULL,       2, 2184);

-- 7-Day Live Quota Inventory Generator (Today + next 7 days)
INSERT INTO inventory_quotas (train_id, journey_date, class_code, quota_code, total_seats, available_seats, waitlist_limit, waitlist_count)
SELECT 
    t.id,
    d.dt,
    c.code AS class_code,
    q.code AS quota_code,
    CASE WHEN q.code = 'TQ' THEN 10 ELSE 42 END AS total_seats,
    CASE WHEN q.code = 'TQ' THEN 10 ELSE 42 END AS available_seats,
    50 AS waitlist_limit,
    0  AS waitlist_count
FROM trains t
CROSS JOIN (
    SELECT CURDATE() AS dt
    UNION SELECT DATE_ADD(CURDATE(), INTERVAL 1 DAY)
    UNION SELECT DATE_ADD(CURDATE(), INTERVAL 2 DAY)
    UNION SELECT DATE_ADD(CURDATE(), INTERVAL 3 DAY)
    UNION SELECT DATE_ADD(CURDATE(), INTERVAL 4 DAY)
    UNION SELECT DATE_ADD(CURDATE(), INTERVAL 5 DAY)
    UNION SELECT DATE_ADD(CURDATE(), INTERVAL 6 DAY)
    UNION SELECT DATE_ADD(CURDATE(), INTERVAL 7 DAY)
) d
CROSS JOIN travel_classes c
CROSS JOIN quotas q;
