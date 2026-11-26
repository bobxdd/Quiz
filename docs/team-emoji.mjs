export const TEAM_EMOJI = 'team-emoji';
export const TEAM_DRAW = 'team-draw';
export const isTeamChallenge = type => type === TEAM_EMOJI || type === TEAM_DRAW;
export const MAX_EMOJI_CLUES = 3;
export const MAX_EMOJI_PALETTE = 96;
export const EMOJI_TIMER_MIN = 5;
export const EMOJI_TIMER_MAX = 180;
export const DRAW_WIDTH = 640;
export const DRAW_HEIGHT = 400;
// Drawings are sent in a single guest request (the transport limit is 18 KB).
export const MAX_DRAW_STROKES = 128;
export const MAX_DRAW_POINTS = 1600;
export const DRAW_COLORS = ['#1c2228','#d73b47','#df791f','#efc32f','#279358','#2579cb','#8046a9','#885138','#ffffff'];
export const DRAW_SIZES = [3, 7, 15];

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

const phaseSeconds = (value, fallback) => {
 const number = Math.round(Number(value));
 return number > 0 ? Math.min(EMOJI_TIMER_MAX, Math.max(EMOJI_TIMER_MIN, number)) : fallback;
};

export function normalizeTeamEmoji(settings = {}) {
 return {
  clueSeconds: phaseSeconds(settings?.clueSeconds, 35),
  guessSeconds: phaseSeconds(settings?.guessSeconds, 25)
 };
}

export function normalizeTeamDraw(settings) {
 return {drawSeconds:phaseSeconds(settings?.drawSeconds, 60), guessSeconds:phaseSeconds(settings?.guessSeconds, 30)};
}

// Fallback for browsers without Intl.Segmenter. Keep emoji sequences together
// but never treat adjacent independent pictographs as one clue.
const fallbackEmojiBase=String.raw`(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0F?\p{Emoji_Modifier}?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?`;
const fallbackEmojiSegments=new RegExp(String.raw`[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|${fallbackEmojiBase}(?:\u200D${fallbackEmojiBase})*|[\s\S]`,'gu');
function emojiSegments(text) {
 const value = String(text ?? '').trim();
 return typeof Intl.Segmenter === 'function'
  ? [...new Intl.Segmenter('de', {granularity:'grapheme'}).segment(value)].map(part => part.segment)
  : (value.match(fallbackEmojiSegments)||[]);
}

const isEmojiSymbol = symbol => typeof symbol === 'string' && symbol.length <= 40 &&
 hasEmojiBase.test(symbol) && emojiGrapheme.test(symbol);

export function emojisFromText(text) {
 return emojiSegments(text).filter(isEmojiSymbol).slice(0, MAX_EMOJI_CLUES);
}

export function parseEmojiPalette(text) {
 const unique = [...new Set(emojiSegments(text).filter(symbol => symbol.trim()))];
 if(!unique.length || unique.length > MAX_EMOJI_PALETTE || unique.some(symbol => !isEmojiSymbol(symbol))) {
  throw Error(`Bitte 1 bis ${MAX_EMOJI_PALETTE} unterschiedliche Emojis als Auswahl hinterlegen.`);
 }
 return unique;
}

const normalizeGuess = text => String(text ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const teamEmojiTarget = question => String(question?.answerText || question?.answer || '').trim();

export function validateTeamEmoji(question, scoreMode) {
 if(scoreMode === 'individual') return 'Für diese Teamrunde im Quiz die Teamwertung auswählen.';
 const target = teamEmojiTarget(question);
 if(!normalizeGuess(target) || target.length > 100) return 'Antwort-Tab ist Pflicht: Einen Champion oder Begriff mit maximal 100 Zeichen eingeben.';
 if(question.type === TEAM_DRAW) return '';
 return '';
}

const clueGiver = team => Object.keys(team.roles).find(id => team.roles[id] === 'clue');
const ready = team => !!clueGiver(team) && Object.values(team.roles).includes('guess');
const clueSymbols = (round, team) => team.clues.map(value => typeof value === 'number' ? round.palette?.[value] : value).filter(Boolean).slice(0,MAX_EMOJI_CLUES);
const hasClue = (round, team) => round.type === TEAM_DRAW ? !!team.drawing?.length : !!team.clues.length;

// Each stroke stores a color index, size index and pairs of canvas coordinates.
function validateDrawing(value) {
 if(!Array.isArray(value) || value.length > MAX_DRAW_STROKES) return false;
 let points = 0;
 for(const stroke of value) {
  if(!Array.isArray(stroke) || stroke.length < 4 || stroke.length % 2) return false;
  const [color,size] = stroke;
  if(!Number.isInteger(color) || !DRAW_COLORS[color] || !Number.isInteger(size) || !DRAW_SIZES[size]) return false;
  points += (stroke.length - 2) / 2;
  if(points > MAX_DRAW_POINTS) return false;
  for(let i = 2; i < stroke.length; i++) {
   if(!Number.isInteger(stroke[i]) || stroke[i] < 0 || stroke[i] > (i % 2 ? DRAW_HEIGHT : DRAW_WIDTH)) return false;
  }
 }
 return true;
}

export function newTeamEmojiRound(question, state, roster, id) {
 const error = validateTeamEmoji(question, state.scoreMode);
 if(error) throw Error(error);
 const teams = Object.fromEntries(Object.keys(state.teams || {}).map(team => [
  team, {players:Object.keys(roster || {}).filter(uid => roster[uid]?.team === team), roles:{}, clues:[], guess:'', active:false}
 ]).filter(([, team]) => team.players.length));
 if(!Object.values(teams).some(team => team.players.length >= 2)) {
  throw Error('Für diese Teamrunde braucht mindestens ein Team zwei freigegebene Spieler.');
 }
 const draw = question.type === TEAM_DRAW;
 const config = draw ? normalizeTeamDraw(question.teamDraw) : normalizeTeamEmoji(question.teamEmoji);
 const target = teamEmojiTarget(question);
 const accepted = [target, ...String(question.acceptedAnswers || '').split(/[\n;,]+/)].map(normalizeGuess).filter(Boolean);
 return {
  id, type:draw ? TEAM_DRAW : TEAM_EMOJI, teams, target, accepted, phase:'roles', deadline:0, points:question.points,
  ...(draw ? {reference:question.answerImage || ''} : {}),
  clueSeconds:draw ? config.drawSeconds : config.clueSeconds, guessSeconds:config.guessSeconds
 };
}

export function playTeamEmoji(round, teamId, uid, action, value, now, {draft=false}={}) {
 const team = Object.hasOwn(round.teams, teamId) ? round.teams[teamId] : null;
 if(!team?.players.includes(uid) || team.players.length < 2) throw Error('Dein Team braucht mindestens zwei Spieler.');
 if(round.deadline && now >= round.deadline) throw Error('Die Zeit für diese Phase ist abgelaufen.');
 if(action === 'role' && round.phase === 'roles' && ['clue','guess'].includes(value)) {
  const current = clueGiver(team);
  if(value === 'clue' && current && current !== uid) throw Error('Dein Team hat bereits einen Hinweisgeber.');
  team.roles[uid] = value;
 }else if(action === 'clue' && round.phase === 'clues' && team.active && team.roles[uid] === 'clue') {
  if(round.type === TEAM_DRAW) {
   if(!validateDrawing(value)) throw Error('Die Zeichnung enthält ungültige Striche oder ist zu groß.');
   team.drawing = value.map(stroke => stroke.slice());
  }else{
   if(!Array.isArray(value) || (!draft && !value.length) || value.length > MAX_EMOJI_CLUES ||
      Array.from(value).some(symbol => !isEmojiSymbol(symbol) || emojiSegments(symbol).length !== 1)) {
    throw Error('Wähle maximal drei einzelne Emojis.');
   }
   team.clues = value.slice();
  }
 }else if(action === 'guess' && round.phase === 'guess' && team.active && team.roles[uid] === 'guess' && hasClue(round, team)) {
  const guess = typeof value === 'string' ? value.trim() : '';
  if(guess.length > 100 || (!draft && !normalizeGuess(guess))) throw Error('Gib einen Champion oder Begriff mit maximal 100 Zeichen ein.');
  team.guess = guess;
  if(!draft && allTeamsGuessed(round))waitForTeamReveal(round);
 }else {
  throw Error('Diese Aktion ist in deiner Rolle oder Phase nicht verfügbar.');
 }
 return true;
}

function allTeamsGuessed(round){
 return Object.values(round.teams).filter(team=>team.active&&hasClue(round,team)).every(team=>!!team.guess);
}
function waitForTeamReveal(round){round.phase='awaiting-reveal';round.deadline=0;}
export function canRevealTeamEmoji(round){
 return round.phase==='awaiting-reveal'||round.phase==='guess'&&allTeamsGuessed(round);
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
  if(allTeamsGuessed(round))waitForTeamReveal(round);
 }else if(round.phase === 'guess' && now >= round.deadline) {
  waitForTeamReveal(round);
 }else return false;
 return true;
}
export function finishTeamEmoji(round){
 if(!canRevealTeamEmoji(round))return false;
 round.phase='reveal';
 round.deadline=0;
 round.results=Object.entries(round.teams).map(([id,team])=>{
  const correct=team.active&&hasClue(round,team)&&!!team.guess&&round.accepted.includes(normalizeGuess(team.guess));
  const status=!team.active?'no-roles':!hasClue(round,team)?'no-clues':!team.guess?'no-guess':correct?'correct':'wrong';
  return {id,status,clues:clueSymbols(round,team),guess:team.guess,points:correct?round.points:0,
   ...(round.type===TEAM_DRAW ? {drawing:team.drawing||[]} : {})};
 });
 return true;
}

export function publicTeamEmoji(round) {
 const teams = Object.entries(round.teams).map(([id, team]) => ({
  id, players:team.players.length, ready:ready(team), clued:hasClue(round,team), guessed:!!team.guess
 }));
 return {id:round.id, type:round.type||TEAM_EMOJI, phase:round.phase, teams, canReveal:canRevealTeamEmoji(round),
  ...(round.phase === 'reveal' ? {solution:round.target, results:round.results} : {})};
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
  return {...own, target:round.target, ...(round.type===TEAM_DRAW ?
   {reference:round.reference, drawing:team.drawing||[]} : {selected:clueSymbols(round,team)})};
 }
 if(round.phase === 'guess' && team.active && role === 'guess') {
  return {...own, clues:clueSymbols(round,team),guess:team.guess,...(round.type===TEAM_DRAW ? {drawing:team.drawing||[]} : {})};
 }
 return own;
}
