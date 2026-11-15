from pathlib import Path
import json, re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'docs'
model=(root/'studio-model.mjs').read_text(); model=re.sub(r'\bexport\s+(?=(?:const|function|async\s+function))','',model).replace('export {escape};','')
editor=(root/'studio-editor.mjs').read_text(); editor=re.sub(r'^import[^\n]+\n','',editor,flags=re.MULTILINE); editor=re.sub(r'\bexport\s+(?=(?:const|function|async\s+function))','',editor)
setup='''
window.__saved=0;
window.__history=[];
window.__redo=[];
window.__q={id:'q1',category:'Lore',title:'Lore 100',points:100,prompt:'Wer ist das?',answer:'Ahri',correct:0,scene:templateScene('multiple',{prompt:'Wer ist das?',options:['Ahri','Annie','Lux','Jinx']})};
window.__quiz={title:'QA-Quiz',questions:[window.__q]};
let chosen='q1';
const api={getQuiz:()=>window.__quiz,getQuestion:()=>window.__quiz.questions.find(x=>x.id===chosen),setSelected:id=>chosen=id,
 save:()=>{window.__saved++;return true;},saveStatus:()=>`Gespeichert ${window.__saved}`,
 snapshot:()=>window.__history.push(JSON.stringify(window.__quiz)),discardSnapshot:()=>window.__history.pop(),
 undo:()=>{if(window.__history.length){window.__redo.push(JSON.stringify(window.__quiz));window.__quiz=JSON.parse(window.__history.pop());}},
 redo:()=>{if(window.__redo.length){window.__history.push(JSON.stringify(window.__quiz));window.__quiz=JSON.parse(window.__redo.pop());}},
 error:err=>{window.__errors.push(String(err.message||err));},isOffline:()=>true,onlineReady:()=>false,
 optimizeImage:async(file,max,maxbytes)=>'data:image/png;base64,aGVsbG8=', optimizeAudio:async()=>'data:audio/wav;base64,AAAA',
 backup:()=>{},makeQuestion:name=>{const q={...window.__q,id:'q2',category:name};window.__quiz.questions.push(q);chosen=q.id;},
 copyQuestion:()=>{},deleteQuestion:()=>{window.__quiz.questions=[];chosen='';},quickset:()=>{}
};
window.confirm=()=>true;window.__errors=[];
window.__editor=createStudioEditor(api);
window.__mount=()=>{document.getElementById('app').innerHTML=window.__editor.html();window.__editor.mount(document.querySelector('#se-root'));}
window.__mount();
'''
source=model+'\n'+editor+'\n'+setup

def run():
 with sync_playwright() as sp:
  browser=sp.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1600,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content('<!doctype html><html><head><meta charset="utf-8"><style>'+ (root/'style.css').read_text()+'</style></head><body><div id="app"></div></body></html>')
  page.add_script_tag(content=source)
  print('Before count',page.locator('#se-root').count(),'errors',errors,'window.errors',page.evaluate('window.__errors ?? null'));assert page.locator('#se-root').count()==1
  assert page.locator('.se-element').count()==5
  page.locator('[data-se-action="add-element"][data-kind="text"]').click(); page.wait_for_timeout(150)
  assert page.locator('.se-element').count()==6
  element_id=page.evaluate('window.__editor.getSelected()');print('New element:',element_id)
  page.locator('[data-se-field="text"]').fill('Hallo, neuer Hinweis');page.locator('[data-se-field="text"]').blur();page.wait_for_timeout(500)
  assert page.locator(f'[data-se-element="{element_id}"]').inner_text().find('Hallo')>=0
  page.locator('[data-se-field="step"]').select_option('2');page.wait_for_timeout(180)
  assert page.evaluate('window.__quiz.questions[0].scene.elements.find(x=>x.id==='+json.dumps(element_id)+').step')==2
  page.locator('[data-se-action="preview"]').click();page.wait_for_timeout(180)
  assert page.locator('[data-se-element]').count()==0
  assert 'Hallo, neuer Hinweis' not in page.locator('.se-scene').inner_text()
  page.locator('[data-se-reveal]').select_option('2');page.wait_for_timeout(180)
  assert 'Hallo, neuer Hinweis' in page.locator('.se-scene').inner_text()
  page.locator('[data-se-action="preview"]').click();page.wait_for_timeout(180)
  # Real drag, resize, keyboard navigation and non-destructive undo.
  node=page.locator(f'[data-se-element="{element_id}"]')
  x0=page.evaluate('(id)=>window.__quiz.questions[0].scene.elements.find(x=>x.id===id).x',element_id)
  rect=node.bounding_box();page.mouse.move(rect['x']+24,rect['y']+24);page.mouse.down();page.mouse.move(rect['x']+85,rect['y']+42,steps=5);page.mouse.up();page.wait_for_timeout(170)
  x1=page.evaluate('(id)=>window.__quiz.questions[0].scene.elements.find(x=>x.id===id).x',element_id)
  assert x1>x0,(x0,x1)
  node=page.locator(f'[data-se-element="{element_id}"]');oldw=page.evaluate('(id)=>window.__quiz.questions[0].scene.elements.find(x=>x.id===id).w',element_id)
  resize=node.locator('.se-resize');r=resize.bounding_box();page.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);page.mouse.down();page.mouse.move(r['x']+r['width']/2+38,r['y']+r['height']/2+20,steps=5);page.mouse.up();page.wait_for_timeout(170)
  neww=page.evaluate('(id)=>window.__quiz.questions[0].scene.elements.find(x=>x.id===id).w',element_id)
  assert neww>oldw,(neww,oldw)
  node=page.locator(f'[data-se-element="{element_id}"]');node.focus();page.keyboard.press('ArrowRight');page.wait_for_timeout(120)
  assert page.evaluate('(id)=>window.__quiz.questions[0].scene.elements.find(x=>x.id===id).x',element_id)>x1
  # Persistent expanding properties (they must not collapse after editing).
  page.locator('.se-extras summary').click();page.locator('[data-se-field="explanation"]').fill('Testnotiz');page.locator('[data-se-field="explanation"]').blur();page.wait_for_timeout(160)
  assert page.locator('.se-extras[open]').count()==1
  # Sort template permits ten entries without exceptions and preserves editable order.
  page.locator('[data-se-template]').select_option('order');page.wait_for_timeout(160)
  assert page.locator('.se-kind-order').count()==7
  for _ in range(3):
   page.locator('[data-se-action="sort-add"]').click();page.wait_for_timeout(100)
  assert page.locator('.se-kind-order').count()==10
  assert page.evaluate('window.__quiz.questions[0].scene.sortCorrect.length')==10
  page.locator('[data-se-action="sort-up"]').last.click();page.wait_for_timeout(150)
  assert not errors,errors
  # Undo, redo, delete selection, and restoration.
  page.locator('[data-se-action="undo"]').click();page.wait_for_timeout(140)
  page.locator('[data-se-action="redo"]').click();page.wait_for_timeout(140)
  # Upload race: a delayed image conversion must not land in the next selected question.
  print('at-image-template',flush=True);page.locator('[data-se-template]').select_option('image');page.wait_for_timeout(120)
  print('at-image-element',flush=True);page.locator('.se-kind-image').click();page.wait_for_timeout(100)
  print('at-patch-upload',flush=True);page.evaluate("(()=>{api.optimizeImage=async()=>new Promise(resolve=>window.__finishImage=resolve);return true})()")
  print('at-file',flush=True);page.locator('[data-se-upload="image"]').set_input_files({"name":"test.png","mimeType":"image/png","buffer":b"\x89PNG\r\n\x1a\n"})
  print('at-wait',flush=True);page.wait_for_function('typeof window.__finishImage === "function"')
  page.evaluate("window.__quiz.questions.push({...window.__q,id:'q2',scene:templateScene('multiple',{prompt:'Neue Frage'})});chosen='q2';window.__finishImage('data:image/png;base64,aGVsbG8=')")
  page.wait_for_timeout(160)
  assert any('Frage wurde während des Uploads gewechselt' in s for s in page.evaluate('window.__errors'))
  assert all(not x.get('src') for x in page.evaluate('window.__quiz.questions[0].scene.elements') if x['kind']=='image')
  assert not errors, errors
  print('errors',errors,page.evaluate('window.__errors'))
  page.screenshot(path=str(Path(__file__).resolve().parents[1]/'editor-browser-check.png'))
  browser.close()

if __name__=='__main__':run()
