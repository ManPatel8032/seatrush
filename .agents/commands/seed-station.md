---
description: Seed or update a railway station in the SeatRush MySQL/TiDB stations table
---

# /seed-station

Seeds a new railway station or updates an existing station record in the SeatRush `stations` table (MySQL / TiDB persistence layer).

---

## Usage

```bash
/seed-station [code] [name] [city] [state]
```

### Examples:
- `/seed-station PNBE "Patna Jn" "Patna" "Bihar"`
- `/seed-station PUNE "Pune Jn" "Pune" "Maharashtra"`
- `/seed-station HYB "Hyderabad Deccan" "Hyderabad" "Telangana"`
- `/seed-station JAT "Jammu Tawi" "Jammu" "Jammu and Kashmir"`
- `/seed-station --list` (lists all stations currently in the database)

---

## Instructions for Agent

When this command is invoked:

### Step 1: Parse and Validate Arguments
1. Extract the station parameters from the user prompt:
   - **`code`**: Station code (2 to 10 alphanumeric characters, convert to uppercase, e.g., `PNBE`).
   - **`name`**: Full station name (e.g., `Patna Jn`).
   - **`city`**: City where the station is located (e.g., `Patna`).
   - **`state`**: State or Union Territory (e.g., `Bihar`).
2. If the user passed `--list`, execute:
   ```bash
   node backend/seed-station.js --list
   ```
   and display the current stations table to the user.
3. If any required fields (`code`, `name`, `city`, `state`) are missing, prompt the user to provide them or ask for clarification before proceeding.

### Step 2: Database Upsert
Run the backend seeding script with the parsed parameters:
```powershell
node backend/seed-station.js --code <CODE> --name "<NAME>" --city "<CITY>" --state "<STATE>"
```

The script uses a safe, parameterized upsert query:
```sql
INSERT INTO stations (code, name, city, state)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  city = VALUES(city),
  state = VALUES(state);
```

### Step 3: Verify and Present Output
1. Confirm the record was written into MySQL/TiDB.
2. Present a clear confirmation table to the user:

| Station Code | Station Name | City | State | Status |
| :--- | :--- | :--- | :--- | :--- |
| `<CODE>` | `<NAME>` | `<CITY>` | `<STATE>` | ✅ Seeded / Updated |

3. Remind the user that the new station is now available for route planning, schedule queries (`/api/trains/search`), and frontend station selectors (`/api/stations`).
