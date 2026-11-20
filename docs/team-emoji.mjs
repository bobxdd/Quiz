export const TEAM_EMOJI = 'team-emoji';
export const MAX_EMOJI_CLUES = 5;
export const MAX_EMOJI_PALETTE = 96;
export const EMOJI_TIMER_MIN = 5;
export const EMOJI_TIMER_MAX = 180;

// Older quiz files stored the exact original default as if it were a custom palette.
const legacyDefaultPalette = '🔥 ❄️ ⚡ 🌊 🌪️ 🌿 🌙 ☀️ ⭐ ✨ 🌈 🌋 🗡️ 🏹 🛡️ 🔨 ⚙️ 🤖 💣 ☠️ 👻 😈 🎭 👑 🧪 🎵 🔮 💎 ❤️ 🤝 🦊 🐻 🐺 🐱 🐦 🐉 🕷️ 🐍 🦈 🦋 🐵 🍄 👁️ 🩸 ⏳ 🧊 🍌 🏴‍☠️';
const emojiByGroup = {
 Natur:{'🔥':'Feuer','❄️':'Schneeflocke','⚡':'Blitz','🌊':'Welle','🌪️':'Wirbelsturm','🌿':'Blatt','🌙':'Mond','☀️':'Sonne',
  '🌈':'Regenbogen','🌋':'Vulkan','🧊':'Eiswürfel','💧':'Wassertropfen','☁️':'Wolke','🌳':'Baum','⛰️':'Berg','🍄':'Pilz'},
 Tiere:{'🦊':'Fuchs','🐻':'Bär','🐺':'Wolf','🐱':'Katze','🐦':'Vogel','🐉':'Drache','🕷️':'Spinne','🐍':'Schlange',
  '🦈':'Hai','🦋':'Schmetterling','🐵':'Affe','🦇':'Fledermaus','🐸':'Frosch','🐢':'Schildkröte','🐝':'Biene','🦂':'Skorpion'},
 Kampf:{'🗡️':'Dolch','⚔️':'Gekreuzte Schwerter','🏹':'Bogen','🛡️':'Schild','🔨':'Hammer','🪓':'Axt','💣':'Bombe',
  '🪃':'Bumerang','🎯':'Zielscheibe','🩸':'Blutstropfen','🦾':'Roboterarm','🥊':'Boxhandschuh','🦴':'Knochen','💥':'Explosion'},
 Magie:{'⭐':'Stern','✨':'Funkeln','🔮':'Kristallkugel','🧪':'Reagenzglas','👻':'Geist','☠️':'Totenkopf','😈':'Teufel',
  '🧙':'Magier','🧛':'Vampir','🧚':'Fee','🦄':'Einhorn','🌀':'Wirbel','🪄':'Zauberstab','🧞':'Flaschengeist'},
 Figuren:{'🤖':'Roboter','🎭':'Masken','👁️':'Auge','🤝':'Händedruck','😀':'Lächeln','😂':'Lachen','😭':'Weinen',
  '😠':'Wut','😱':'Schreck','😴':'Schlaf','🤡':'Clown','👶':'Baby','👵':'Ältere Frau','👀':'Augen'},
 Dinge:{'⚙️':'Zahnrad','👑':'Krone','🎵':'Musik','💎':'Edelstein','❤️':'Herz','⏳':'Sanduhr','🍌':'Banane','🏴‍☠️':'Piratenflagge',
  '⚓':'Anker','🧭':'Kompass','🪙':'Münze','🗝️':'Schlüssel','🎩':'Zylinder','🍺':'Bier','🥕':'Karotte','📖':'Buch'}
};
const emojiMetadata = new Map(Object.entries(emojiByGroup).flatMap(([group, names]) =>
 Object.entries(names).map(([symbol, name]) => [symbol, {group, name}])));
const defaultPalette = [...emojiMetadata.keys()].join(' ');
const emojiGrapheme = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|[\u200D\uFE0F\u20E3\u{E0020}-\u{E007F}]|[0-9#*](?=\uFE0F?\u20E3))+$/u;
const hasEmojiBase = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u20E3]/u;

export function emojiName(emoji) {
 return emojiMetadata.get(emoji)?.name || 'Emoji ' + emoji;
}

export function emojiGroup(emoji) {
 return emojiMetadata.get(emoji)?.group || 'Weitere';
}

export function normalizeTeamEmoji(settings = {}) {
 const seconds = (value, fallback) => {
  const number = Math.round(Number(value));
  return number > 0 ? Math.min(EMOJI_TIMER_MAX, Math.max(EMOJI_TIMER_MIN, number)) : fallback;
 };
 const palette = String(settings?.palette ?? '').trim();
 return {
  palette: !palette || palette === legacyDefaultPalette ? defaultPalette : palette.slice(0, 4000),
  clueSeconds: seconds(settings?.clueSeconds, 35),
  guessSeconds: seconds(settings?.guessSeconds, 25)
 };
}

export function parseEmojiPalette(text) {
 const value = String(text ?? '').trim();
 const segments = typeof Intl.Segmenter === 'function'
  ? [...new Intl.Segmenter('de', {granularity:'grapheme'}).segment(value)].map(part => part.segment)
  : value.split(/\s+/u);
 const symbols = segments.filter(symbol => symbol.trim());
 const unique = [...new Set(symbols)];
 if(!unique.length || unique.length > MAX_EMOJI_PALETTE || unique.some(symbol => symbol.length > 40 || !hasEmojiBase.test(symbol) || !emojiGrapheme.test(symbol))) {
  throw Error(`Bitte 1 bis ${MAX_EMOJI_PALETTE} unterschiedliche Emojis als Auswahl hinterlegen.`);
 }
 return unique;
}

const normalizeGuess = text => String(text ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const teamEmojiTarget = question => String(question?.answerText || question?.answer || '').trim();

export function validateTeamEmoji(question, scoreMode) {
 if(scoreMode === 'individual') return 'Für die Emoji-Teamrunde im Quiz die Teamwertung auswählen.';
 const target = teamEmojiTarget(question);
 if(!normalizeGuess(target) || target.length > 100) return 'Antwort-Tab ist Pflicht: Einen Champion oder Begriff mit maximal 100 Zeichen eingeben.';
 try { parseEmojiPalette(normalizeTeamEmoji(question.teamEmoji).palette); }
 catch(error) { return error.message; }
 return '';
}

const clueGiver = team => Object.keys(team.roles).find(id => team.roles[id] === 'clue');
const ready = team => !!clueGiver(team) && Object.values(team.roles).includes('guess');

export function newTeamEmojiRound(question, state, roster, id) {
 const error = validateTeamEmoji(question, state.scoreMode);
 if(error) throw Error(error);
 const teams = Object.fromEntries(Object.keys(state.teams || {}).map(team => [
  team, {players:Object.keys(roster || {}).filter(uid => roster[uid]?.team === team), roles:{}, clues:[], guess:'', active:false}
 ]).filter(([, team]) => team.players.length));
 if(!Object.values(teams).some(team => team.players.length >= 2)) {
  throw Error('Für die Emoji-Teamrunde braucht mindestens ein Team zwei freigegebene Spieler.');
 }
 const config = normalizeTeamEmoji(question.teamEmoji);
 const target = teamEmojiTarget(question);
 const accepted = [target, ...String(question.acceptedAnswers || '').split(/[\n;,]+/)].map(normalizeGuess).filter(Boolean);
 return {
  id, teams, target, accepted, phase:'roles', deadline:0, points:question.points,
  palette:parseEmojiPalette(config.palette), clueSeconds:config.clueSeconds, guessSeconds:config.guessSeconds
 };
}

export function playTeamEmoji(round, teamId, uid, action, value, now) {
 const team = Object.hasOwn(round.teams, teamId) ? round.teams[teamId] : null;
 if(!team?.players.includes(uid) || team.players.length < 2) throw Error('Dein Team braucht mindestens zwei Spieler.');
 if(round.deadline && now >= round.deadline) throw Error('Die Zeit für diese Phase ist abgelaufen.');
 if(action === 'role' && round.phase === 'roles' && ['clue','guess'].includes(value)) {
  const current = clueGiver(team);
  if(value === 'clue' && current && current !== uid) throw Error('Dein Team hat bereits einen Hinweisgeber.');
  team.roles[uid] = value;
 }else if(action === 'clue' && round.phase === 'clues' && team.active && team.roles[uid] === 'clue') {
  if(!Array.isArray(value) || value.length < 1 || value.length > MAX_EMOJI_CLUES ||
     Array.from(value).some(index => !Number.isInteger(index) || index < 0 || index >= round.palette.length)) {
   throw Error('Wähle bis zu fünf Emojis aus der vorgegebenen Auswahl.');
  }
  team.clues = value.slice();
 }else if(action === 'guess' && round.phase === 'guess' && team.active && team.roles[uid] === 'guess' && team.clues.length) {
  const guess = typeof value === 'string' ? value.trim() : '';
  if(guess.length > 100 || !normalizeGuess(guess)) throw Error('Gib einen Champion oder Begriff mit maximal 100 Zeichen ein.');
  team.guess = guess;
 }else {
  throw Error('Diese Aktion ist in deiner Rolle oder Phase nicht verfügbar.');
 }
 return true;
}

export function advanceTeamEmoji(round, now) {
 if(round.phase === 'roles') {
  if(!Object.values(round.teams).some(ready)) throw Error('Mindestens ein Team braucht einen Hinweisgeber und eine ratende Person.');
  for(const team of Object.values(round.teams)) team.active = ready(team);
  round.phase = 'clues';
  round.deadline = now + round.clueSeconds * 1000;
 }else if(round.phase === 'clues' && now >= round.deadline) {
  round.phase = 'guess';
  round.deadline = now + round.guessSeconds * 1000;
 }else if(round.phase === 'guess' && now >= round.deadline) {
  finishTeamEmoji(round);
 }else return false;
 return true;
}
export function finishTeamEmoji(round){
 round.phase='reveal';
 round.deadline=0;
 round.results=Object.entries(round.teams).map(([id,team])=>{
  const correct=!!team.guess&&round.accepted.includes(normalizeGuess(team.guess));
  const status=!team.active?'no-roles':!team.clues.length?'no-clues':!team.guess?'no-guess':correct?'correct':'wrong';
  return {id,status,clues:team.clues.map(index=>round.palette[index]),guess:team.guess,points:correct?round.points:0};
 });
}

export function publicTeamEmoji(round) {
 const teams = Object.entries(round.teams).map(([id, team]) => ({
  id, players:team.players.length, ready:ready(team), clued:!!team.clues.length, guessed:!!team.guess
 }));
 return {id:round.id, phase:round.phase, teams, ...(round.phase === 'reveal' ? {solution:round.target, results:round.results} : {})};
}

export function teamEmojiForPlayer(round, teamId, uid) {
 if(!round || round.phase === 'reveal') return null;
 const team = Object.hasOwn(round.teams, teamId) ? round.teams[teamId] : null;
 if(!team?.players.includes(uid)) return null;
 const role = team.roles[uid] || '';
 const own = {
  id:round.id, role, players:team.players.length, active:team.active, ready:ready(team),
  clueTaken:!!clueGiver(team) && role !== 'clue', answered:!!team.guess
 };
 if(round.phase === 'clues' && team.active && role === 'clue') {
  return {...own, target:round.target, palette:round.palette, selected:team.clues};
 }
 if(round.phase === 'guess' && team.active && role === 'guess') {
  return {...own, clues:team.clues.map(index => round.palette[index]),guess:team.guess};
 }
 return own;
}
