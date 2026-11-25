# TPG Match 配对系统 (draft)

Login portal for TPG agents: Industry, Residential and My Matches (WTB/WTR) in one place.

- Hosted on GitHub Pages; data lives in Supabase and is only readable by logged-in, active, allow-listed members (Row Level Security).
- `config.js` holds the project URL and the *publishable* key, which is public by design. No secret keys are stored in this repo.
- `industry/` and `residential/` are the existing search pages, unchanged except that data is loaded from Supabase through the portal.
