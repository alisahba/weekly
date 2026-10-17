# Dinners

Our weekly dinner menu: 7 gluten-free dinners for two, 30 minutes or less, at least 20g protein each.
Published with GitHub Pages and installable on iPhone (Share → Add to Home Screen).

## How it's updated
Every Saturday a scheduled Claude task plans the week, fills the Tesco basket and pushes a new week here:

1. Add `data/weeks/YYYY-MM-DD.json` (the Saturday's date).
2. Put the new week at the top of `data/index.json`.

## Week file schema
```json
{
  "id": "2026-10-17", "label": "17–23 October", "start": "2026-10-17",
  "notes": ["…"],
  "dinners": [{
    "night": 1, "title": "…", "time": "25 min", "protein": "≈30g", "method": "Air fryer",
    "colour": "#2B50FF", "ink": "#FFFFFF",
    "ingredients": [{"qty": "150g", "item": "basmati rice"}],
    "steps": ["…"], "tip": "…"
  }],
  "shopping": {"total": "£88.87", "items": 46, "groups": {"Protein": ["…"]}}
}
```
Night colours, in order (colour / ink): #2B50FF/#FFFFFF, #FF3D7F/#000000, #00A86B/#000000, #FFB000/#000000, #7A3CFF/#FFFFFF, #00B3C7/#000000, #FF5A1F/#000000.

Order the nights by freshness: fish and prawns first, then mince, then other meat, with eggs and veg last.

`index.json`: `{"weeks": [{"id", "label", "dinners": [titles], "colours": [7 hex]}]}`, newest first.

Static site, no build step. Bump `SHELL` in `sw.js` when changing `app.js` or `styles.css`, so installed copies update.
