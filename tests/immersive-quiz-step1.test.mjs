import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../docs/session-ui.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
test('step 1: all live scenes share a full-width question panel',()=>{
 assert.match(css,/body\.bq-game-mode:has\(\.bq-question-scene\) \.shell\{/);
 assert.match(css,/\.bq-question-scene \.bq-question-body\{[\s\S]*?flex-direction:column/);
 assert.match(css,/\.bq-question-scene \.bq-question-panel\{/);
});
test('step 1: review answers are scrollable and do not keep legacy mobile height cap',()=>{
 assert.match(css,/\.bq-question-scene \.bq-answers-panel \.answer-review\{[\s\S]*?overflow-y:auto/);
 assert.match(css,/@media\(max-width:780px\)\{[\s\S]*?\.bq-question-scene \.bq-answer-review-body \.bq-answers-panel\{\s*max-height:none/);
});
test('step 1: responsive input does not overlap submit button',()=>{
 assert.match(css,/\.bq-question-scene \.bq-guest-compose \.formgrid>\.btn\{\s*grid-column:1;grid-row:auto/);
 assert.match(css,/\.bq-question-scene \.bq-guest-compose \.formgrid>\.span2\{grid-column:1\}/);
});
test('step 1: live rerenders retain scroll for question, compose, and review',()=>{
 for(const sel of ['.bq-scene-content','.bq-guest-compose','.bq-answers-panel .answer-review'])assert.ok(js.includes(sel),'missing '+sel);
 assert.match(js,/function preserveForm\(draw\)/);
 assert.match(js,/el\.scrollTop=item\.nearBottom\?el\.scrollHeight: item\.top/);
});
test('step 1: rendering keeps host and guest private boundaries',()=>{
 assert.match(js,/function renderHostLive\(/);
 assert.match(js,/function renderGuestLive\(/);
 assert.match(js,/function renderReviewView\(/);
 assert.match(js,/function hostPrivateSolution\(/);
});
