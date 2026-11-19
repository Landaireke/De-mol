# Among Us · klasversie
Realtime server (Express + socket.io) voor de Smartschool Reveal-extensie.
Spelers openen het spel vanuit de extensie met een kort geldig ticket (HMAC, gedeeld geheim `AU_SECRET`) en komen automatisch in de lobby van hun klas.

Render: build `cd amongus && npm install`, start `cd amongus && node server.js`, env `AU_SECRET`.
