"""Verify all four actual original WebP arm cutouts and shoulder motion in Chromium.
Self-contained fixture exercises real production CSS/image sources at fixed instants.
This test cannot by itself judge artistic quality, so it saves four-class screenshots.
"""
import asyncio, importlib.util
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa-artifacts';OUT.mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('bq_original_arm_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
ACTORS=['rogue','blades','mage','druid']

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':1120,'height':700},reduced_motion='no-preference')
  errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
  await fixture.install(page)
  await page.evaluate("""actors=>{
   const stage=document.createElement('section');stage.id='bq-arm-audit';
   stage.style.cssText='position:relative;z-index:90;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px;background:#222932;padding:24px;margin:20px auto;border-radius:12px;max-width:1080px';
   for(const actor of actors){
    const column=document.createElement('div');column.style.cssText='display:grid;gap:8px;justify-items:center;min-width:0';
    column.innerHTML='<strong style="color:#e6e9ec">'+actor+'</strong>'+
     '<div class="bq-map-throw-actor bq-map-throw-actor--'+actor+'" style="position:relative;left:auto;top:auto;animation:none;scale:1">'+
     '<span class="bq-map-throw-body bq-actor bq-actor--'+actor+'"></span>'+
     '<span class="bq-map-throw-arm-rig"><span class="bq-map-throw-original-arm bq-actor--'+actor+'"></span>'+
     '<img class="bq-map-throw-held" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 36%22%3E%3Cpath d=%22M4 0h4v23h3v3H8v10H4V26H1v-3h3Z%22 fill=%22%23bfd8d3%22/%3E%3C/svg%3E" alt=""></span>'+
     '</div>';
    column.querySelector('.bq-map-throw-arm-rig').style.animationPlayState='paused';
    stage.appendChild(column);
   }
   document.body.prepend(stage);
  }""",ACTORS)
  for moment,label in [(200,'resting'),(950,'lifting'),(1980,'raised'),(2670,'followthrough')]:
   result=await page.evaluate("""async ({moment,actors})=>{
    const cards=[...document.querySelectorAll('#bq-arm-audit>.bq-map-throw-actor')];
    const stage=document.querySelector('#bq-arm-audit');
    const statuses=[];
    for(const [i,actor] of actors.entries()){
      const card=stage.children[i],body=card.querySelector('.bq-map-throw-body'),
       limb=card.querySelector('.bq-map-throw-original-arm'),rig=card.querySelector('.bq-map-throw-arm-rig');
      rig.style.animationDelay='-'+(moment/1000)+'s';
      rig.style.animationPlayState='paused';
      const bodyURL=getComputedStyle(body).backgroundImage;
      const armURL=getComputedStyle(limb).backgroundImage;
      const armStyle=getComputedStyle(limb);
      const parsed=armStyle.clipPath.matchAll(/([0-9.]+)%\\s+([0-9.]+)%/g);
      const polygon=[...parsed].map(m=>[Number(m[1])*3,Number(m[2])*3]);
      const image=new Image();
      image.src=armURL.slice(5,-2);await image.decode();
      const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(image,0,0,300,300);
      const data=context.getImageData(0,0,300,300).data;
      const inside=(x,y)=>{
       let inPolygon=false;
       for(let j=0,k=polygon.length-1;j<polygon.length;k=j++){
         const a=polygon[j],b=polygon[k];
         if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inPolygon=!inPolygon;
       }return inPolygon;
      };
      let alpha=0,total=0;
      for(let y=0;y<300;y+=2)for(let x=0;x<300;x+=2)
        if(inside(x,y)){total++;if(data[(y*300+x)*4+3]>35)alpha++;}
      statuses.push({actor,exact:bodyURL===armURL&&bodyURL.includes('image/webp'),
        armCut:armStyle.clipPath,bodyCut:getComputedStyle(body).clipPath,
        pivot:getComputedStyle(rig).transformOrigin,animation:getComputedStyle(rig).animationName,
        transform:getComputedStyle(rig).transform,alpha,total,rendering:armStyle.imageRendering,
        fake:card.querySelectorAll('.bq-map-throw-hand,.bq-map-throw-arm:not(.bq-map-throw-arm-rig)').length});
    }
    return statuses;
   }""",{'moment':moment,'actors':ACTORS})
   for item in result:
    clean={k:v for k,v in item.items() if k not in ['armCut','bodyCut','transform']}
    assert item['exact'] and item['rendering']=='pixelated',clean
    assert item['animation']=='bq-map-original-arm-lift' and item['pivot'] not in ['71px 71px','50% 50%'],clean
    assert item['armCut'].startswith('polygon(') and item['bodyCut'].startswith('polygon(') and item['fake']==0,clean
    assert item['total']>=100 and item['alpha']>=15,clean
   if label=='resting':base=[x['transform'] for x in result]
   if label=='raised':assert all(x['transform']!=base[i] for i,x in enumerate(result)),result
   await page.locator('#bq-arm-audit').screenshot(path=str(OUT/f'original-arm-{label}.png'),animations='allow')
   print('PASS original WebP arms at '+label+': '+', '.join(x['actor']+' '+str(x['alpha'])+'/'+str(x['total'])+' arm pixels' for x in result),flush=True)
  assert not errors,errors
  await browser.close()

if __name__=='__main__':asyncio.run(main())
