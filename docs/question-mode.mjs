import {isTeamChallenge} from './team-emoji.mjs';

export function questionRoundMode(question,type=question?.type){
 if(isTeamChallenge(type))return type;
 return ['map','order'].includes(type)||question?.roundMode==='written'?'written':'buzzer';
}
