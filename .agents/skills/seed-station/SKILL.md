---
name: seed-station
description: Seed or update a railway station in the SeatRush MySQL/TiDB stations table. Use when the user asks to seed, add, register, or update a railway station (or runs /seed-station).
---

# Seed Station Skill (`/seed-station`)

This skill seeds a new railway station or updates an existing station record in the SeatRush `stations` table (MySQL / TiDB persistence layer).

## Usage
- Run as command: `/seed-station <code> <name> <city> <state>`
- Or ask in natural language: *"Seed station PNBE (Patna Jn, Patna, Bihar)"*
- Or list stations: `/seed-station --list` or `node backend/seed-station.js --list`

## Procedure

1. **Parse & Validate Parameters**:
   - `code`: 2–10 uppercase characters (e.g. `PNBE`, `PUNE`, `HYB`)
   - `name`: Station name (e.g. `Patna Jn`)
   - `city`: City (e.g. `Patna`)
   - `state`: State or UT (e.g. `Bihar`)
   - If any parameter is missing, prompt the user for it.

2. **Execute Seeding**:
   Run the backend helper script:
   ```bash
   node backend/seed-station.js --code <CODE> --name "<NAME>" --city "<CITY>" --state "<STATE>"
   ```

3. **Verify & Display**:
   Confirm the record in the database and display a summary table showing code, name, city, and state.
