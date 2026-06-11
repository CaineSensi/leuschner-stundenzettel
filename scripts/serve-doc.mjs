import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const FILE = 'L:\\Leuschner APP\\Leuschner_Rechnungspositionen.html';
createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(readFileSync(FILE));
}).listen(8731, () => console.log('serving on http://127.0.0.1:8731/'));
