"""Run against an actual local server serving the embedded frontend, not mock modules."""
import os,subprocess,time,pathlib,asyncio,shutil
from playwright.async_api import async_playwright
root=pathlib.Path(__file__).resolve().parents[2]
binpath=root/'release-windows/BrainQuizStudio_1_3_Linux_test'
async def main():
 server=subprocess.Popen([str(binpath),'-no-browser','-port','19348'],cwd=root/'windows-source',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  await asyncio.sleep(.5)
  async with async_playwright() as p:
   browser=await p.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox','--no-proxy-server','--proxy-bypass-list=<-loopback>'])
   page=await browser.new_page(viewport={'width':1366,'height':860});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   res=await page.goto('http://127.0.0.1:19348/studio/',wait_until='load');assert res.status==200,res.status
   await page.locator('[data-action="create-offline"]').click()
   await page.locator('.editor-studio').wait_for(timeout=4000)
   await page.locator('[data-action="new-q"]').click()
   await page.locator('#q-prompt').fill('Ist das aus dem eingebetteten Modul?')
   await page.locator('[data-action="add-block"][data-block-type="heading"]').click()
   await page.locator('#block-text').fill('EINBETTUNG ERFOLGREICH')
   await page.wait_for_timeout(400)
   assert 'EINBETTUNG ERFOLGREICH' in await page.locator('.studio-canvas').inner_text()
   assert not errors,errors
   print('PASS: Go-HTTP-Server -> echtes HTML/CSS/JS-Modul, Editor startet und ist bedienbar, JS exceptions = 0')
   await browser.close()
 finally:
  server.terminate()
  try:server.wait(timeout=3)
  except subprocess.TimeoutExpired:server.kill()
if __name__=='__main__':asyncio.run(main())
