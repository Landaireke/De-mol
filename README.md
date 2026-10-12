# De Mol – zelf spelen

Webapp om De Mol zelf te spelen: spelleider + spelers op hun gsm + hoofdscherm (TV/laptop).

## Starten
```bash
npm install
node server.js        # draait op http://0.0.0.0:3000
```
Zorg dat alle toestellen op hetzelfde netwerk zitten (of host de app online, bv. op Render/Railway/een VPS)
en surf naar `http://<ip-van-de-computer>:3000`.

## Rollen
- **Spelleider**: maakt de lobby, kiest/loot de mol, beheert spelers (jokers, vrijstellingen), opdrachten,
  de pot, molinfo, tests, executie en finale. Bewaar de *spelleiderlink* om later te hervatten.
- **Speler** (eigen gsm): geheime rolonthulling, molboekje (notities + verdenkingsmeter), molinfo,
  opdrachten (de mol ziet zijn geheime sabotage-opdrachten), de test en eigen groen/rood scherm.
- **Hoofdscherm**: lobby/uitnodiging, dashboard, pot, molinfo, testvoortgang, executie, finale.
  De spelleider bepaalt bovenaan (📺) wat er op het hoofdscherm staat.

## Spelregels in de app
- Juist antwoord per vraag: zelf vastleggen, of leeg laten → het antwoord van de mol telt
  (de mol vult de test naar waarheid over zichzelf in). "Wie is de mol?" wordt automatisch gescoord.
- Laagste score valt af, bij gelijkstand de traagste. Elke joker = 1 extra juist antwoord.
  Een vrijstelling wordt automatisch ingezet bij het sluiten van de test. De mol kan niet afvallen.
- Finale: de beste niet-mol op de gekozen finaletest wint de pot.
- Tijdens de executie kan de spelleider ook op de **spatiebalk** drukken voor de volgende naam.

## Opslag
Alles wordt bewaard in `data/lobbies.json`, dus een spel kan over meerdere dagen lopen.
