"""Real Chromium test: drag image files from the OS into the editor's DOM drop targets."""
import asyncio,base64,importlib.util,shutil,struct,zlib
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('brainquiz_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def png(r,g,b):
 def chunk(tag,data):
  return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
 row=b'\0'+bytes([r,g,b,255])*2
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(row*2))+chunk(b'IEND',b'')

async def drop(page,selector,*items):
 await page.evaluate("""({selector,items})=>{
  const el=document.querySelector(selector);
  if(!el)throw Error('No drop target: '+selector);
  const dataTransfer=new DataTransfer();
  for(const item of items){
   const bytes=Uint8Array.from(atob(item.payload),c=>c.charCodeAt(0));
   dataTransfer.items.add(new File([bytes],item.name,{type:item.type}));
  }
  const rect=el.getBoundingClientRect(),opts={bubbles:true,cancelable:true,dataTransfer,
   clientX:rect.left+rect.width*.55,clientY:rect.top+rect.height*.58};
  el.dispatchEvent(new DragEvent('dragenter',opts));
  el.dispatchEvent(new DragEvent('dragover',opts));
  el.dispatchEvent(new DragEvent('drop',opts));
 }""",{'selector':selector,'items':[{
  'name':name,'type':type_,'payload':base64.b64encode(content).decode()
 } for name,type_,content in items]})

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce')
  errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
  await fixture.install(page)
  await page.locator('.bq-legacy-options>summary').click()
  await page.get_by_role('button',name='Online-Raum erstellen').click()
  await page.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
  await page.locator('[data-se-action="new"][data-template="text"]').click()
  await page.locator('.se-scene.se-editing').wait_for(timeout=15000)
  get_images="""() => window.__probe.getQuiz().questions[0].scene.elements.filter(el=>el.kind==='image')"""
  a=('one.png','image/png',png(211,88,59))
  b=('two.png','image/png',png(41,161,211))
  await drop(page,'.se-scene.se-editing',a,b)
  await page.wait_for_function("() => window.__probe.getQuiz().questions[0].scene.elements.filter(el=>el.kind==='image').length===2")
  images=await page.evaluate(get_images)
  assert [img['alt'] for img in images]==['one.png','two.png'],images
  assert all(img['src'].startswith('data:image/') for img in images)
  assert images[0]['x']>=0 and images[0]['x']+images[0]['w']<=1000
  assert images[0]['y']>=0 and images[0]['y']+images[0]['h']<=560
  print('PASS: two image files dropped into canvas create two optimized, bounded, saved images')
  replace=('replaced.png','image/png',png(77,208,78))
  await drop(page,'.se-element.se-kind-image',replace)
  await page.wait_for_function("() => window.__probe.getQuiz().questions[0].scene.elements.some(el=>el.alt==='replaced.png')")
  images=await page.evaluate(get_images)
  assert len(images)==2,images
  print('PASS: dropping onto existing image replaces it without adding another')
  await page.locator('.se-element.se-kind-image').first.click()
  await page.locator('[data-se-upload-zone="image"]').wait_for(timeout=10000)
  await drop(page,'[data-se-upload-zone="image"]',('inspector.png','image/png',png(55,65,75)))
  await page.wait_for_function("() => window.__probe.getQuiz().questions[0].scene.elements.some(el=>el.alt==='inspector.png')")
  print('PASS: drop on inspector image field')
  await page.locator('[data-se-upload="image"]').set_input_files({'name':'picker.png','mimeType':'image/png','buffer':png(170,77,77)})
  await page.wait_for_function("() => window.__probe.getQuiz().questions[0].scene.elements.some(el=>el.alt==='picker.png')")
  print('PASS: ordinary file picker still works')
  previous=await page.evaluate(get_images)
  await drop(page,'.se-scene.se-editing',('not-image.txt','text/plain',b'not an image'))
  await page.wait_for_timeout(200)
  assert await page.evaluate(get_images)==previous
  print('PASS: rejected non-image does not partially mutate scene')
  await page.locator('[data-se-action="toggle-preview"]').click()
  await drop(page,'.se-scene',a)
  await page.wait_for_timeout(100)
  assert await page.evaluate(get_images)==previous
  assert not errors,errors
  print('PASS: preview rejects file drops; no unhandled page errors')
  await browser.close()

if __name__=='__main__':asyncio.run(main())
