import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hasDraggedFiles,imageFilesFromDrop,imageDropPoint} from '../docs/image-drop.mjs';
const file=(name,type,size=1024)=>({name,type,size});
const image=file('test.png','image/png');
const dt=files=>({types:['Files'],files,items:files.map(f=>({kind:'file',getAsFile:()=>f}))});

test('Image drop recognizes operating-system file drags but not internal text/element drags',()=>{
 assert.equal(hasDraggedFiles({types:['Files'],items:[],files:[]}),true);
 assert.equal(hasDraggedFiles({items:[{kind:'file'}]}),true);
 assert.equal(hasDraggedFiles({types:['text/plain'],items:[]}),false);
 assert.equal(hasDraggedFiles(null),false);
});
test('Image drop accepts PNG, JPEG and WebP and falls back to DataTransferItem.getAsFile',()=>{
 const imgs=[image,file('2.jpg','image/jpeg'),file('3.webp','image/webp')];
 assert.deepEqual(imageFilesFromDrop(dt(imgs)),imgs);
 assert.deepEqual(imageFilesFromDrop({items:[{kind:'file',getAsFile:()=>image}]}),[image]);
});
test('Image drop rejects mixed types, oversized sources, empty drags and oversized batches',()=>{
 assert.throws(()=>imageFilesFromDrop(dt([image,file('evil.svg','image/svg+xml')])),/PNG, JPG oder WebP/);
 assert.throws(()=>imageFilesFromDrop(dt([file('huge.png','image/png',6_000_001)])),/6 MB/);
 assert.throws(()=>imageFilesFromDrop(dt([])),/Keine Bilddatei/);
 assert.throws(()=>imageFilesFromDrop(dt(Array.from({length:11},()=>image))),/maximal 10/);
});
test('Image drop places a centered new element within canvas boundaries',()=>{
 const rect={left:100,top:200,width:800,height:448};
 assert.deepEqual(imageDropPoint(rect,500,424),{x:330,y:180});
 assert.deepEqual(imageDropPoint(rect,-500,-500),{x:0,y:0});
 assert.deepEqual(imageDropPoint(rect,9000,9000),{x:650,y:365});
});
test('Image drop is wired to canvas and file inputs with save, preview and error guards',()=>{
 const editor=readFileSync(new URL('../docs/studio-editor.mjs',import.meta.url),'utf8');
 const css=readFileSync(new URL('../docs/editor-31.css',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../docs/sw.js',import.meta.url),'utf8');
 assert.match(editor,/addEventListener\('dragover'/);
 assert.match(editor,/addEventListener\('drop'/);
 assert.match(editor,/data-se-upload-zone="image"/);
 assert.match(editor,/data-se-upload-zone="correct-icon"/);
 assert.match(editor,/existing\?\.kind==='image'/);
 assert.match(editor,/if\(kind!=='image'\|\|preview\|\|scene\.template==='map'\)/);
 assert.match(editor,/Promise\.all\(files\.map\(file=>api\.optimizeImage/);
 assert.match(editor,/current\(\)\?\.id!==questionId\|\|current\(\)\?\.scene!==scene/);
 assert.match(editor,/if\(bytes>1200000\)/);
 assert.match(editor,/persist\(true\)/);
 assert.match(editor,/preventFileNavigation/);
 assert.match(css,/\.se-editing\.is-file-drop/);
 assert.match(sw,/\.\/image-drop\.mjs/);
 assert.match(sw,/brainquiz-shell-3\.7\.1-image-drop/);
});

test('Chromium fixture resolves the editor image-drop module instead of leaving a Blob-relative import',()=>{
 const fixture=readFileSync(new URL('./categories-3_0-browser.py',import.meta.url),'utf8');
 assert.match(fixture,/image-drop\.mjs/);
 assert.match(fixture,/const imageDrop=blob/);
 assert.match(fixture,/from '\.\/image-drop\.mjs'/);
});
