// The static PeerJS/WebRTC shell needs no per-deploy credentials.
import {existsSync, readFileSync} from 'node:fs';
for (const path of ['docs/index.html','docs/app.mjs','docs/peer-client.mjs','docs/sw.js']) {
 if(!existsSync(path))throw Error('Fehlende GitHub-Pages-Datei: '+path);
}
const source=readFileSync('docs/index.html','utf8');
if(/firebase/i.test(source))throw Error('Firebase-Altlast in index.html');
console.log('BrainQuiz PeerJS WebRTC — statischer GitHub-Pages-Build bereit.');
