// Browser entry point.

import { createApp } from './app.js';

createApp({ document, window }).catch((error) => {
  console.error(error);
  const note = document.getElementById('boot-note');
  if (note) note.textContent = `Aplikacija nije mogla da se pokrene: ${error.message}`;
});
