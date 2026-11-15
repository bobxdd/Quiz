"""Four original 80x96 pixel characters; no held items or class symbols.

The shapes are deliberately different rather than hue-shifting one identical hood.
Each figure is drawn at native pixel resolution and exported with nearest-neighbor
4x scaling for a crisp transparent PNG in GitHub Pages.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]/'docs'
OUTLINE='#19171f'; SHADOW='#292230'; LIGHT='#f7edd8'; PEACH='#e8b8a1'; ROSE='#c98395'

class Sprite:
    def __init__(self):
        self.im=Image.new('RGBA',(80,96),(0,0,0,0))
        self.d=ImageDraw.Draw(self.im)
    def poly(self,coords,fill,stroke=OUTLINE,width=2): self.d.polygon(coords,fill=fill);self.d.line(list(coords)+[coords[0]],fill=stroke,width=width,joint='curve')
    def rect(self,coords,fill,outline=None,width=1): self.d.rectangle(coords,fill=fill,outline=outline,width=width)
    def ellipse(self,coords,fill,outline=None,width=1):self.d.ellipse(coords,fill=fill,outline=outline,width=width)
    def p(self,xy,color):self.d.point(xy,fill=color)
    def end(self,file):
        # visible at native resolution and crisp on 1x / high DPI
        self.im.resize((320,384),Image.Resampling.NEAREST).save(ROOT/file,optimize=True)

# A — compact stitched plum hood, closed starry face, warm little eyes. No weapon.
s=Sprite()
s.ellipse((13,87,66,93),'#0e111580')
s.poly([(26,76),(37,74),(38,88),(33,91),(23,91),(20,87)],'#403545')
s.poly([(45,75),(55,75),(59,89),(55,91),(43,90),(42,84)],'#403545')
s.poly([(17,48),(28,44),(51,45),(62,52),(70,82),(56,87),(40,84),(23,87),(10,83)],'#69445f')
s.poly([(14,71),(21,80),(34,83),(39,77),(46,82),(60,77),(68,80)],'#9d6980',width=1)
s.poly([(17,55),(26,49),(33,70),(17,78),(11,70)],'#83576d')
s.poly([(58,52),(65,62),(69,77),(57,76),(51,65)],'#8e5c73')
s.ellipse((16,65,24,74),'#b07c91',OUTLINE)
s.ellipse((60,65,67,74),'#b07c91',OUTLINE)
s.poly([(11,45),(9,31),(13,18),(21,9),(33,6),(49,8),(60,15),(68,29),(66,45),(56,56),(25,57)],'#8d5878')
s.poly([(15,31),(22,19),(31,13),(47,13),(58,22),(64,33),(57,34),(51,23),(24,23),(17,40)],'#bb8292',width=1)
s.ellipse((20,29,57,51),'#211b2b')
s.rect((29,34,32,44),LIGHT);s.rect((45,34,48,44),LIGHT)
s.rect((29,35,30,39),'#fff8df');s.rect((45,35,46,39),'#fff8df')
# seam / leaf on hood
for x,y in [(25,18),(29,15),(33,12),(37,10)]:s.rect((x,y,x+3,y+1),'#e1b7ab')
s.poly([(15,17),(12,10),(18,10),(24,17),(19,20)],'#7c9781',width=1)
s.poly([(22,14),(23,5),(29,10),(27,20)],'#adbb91',width=1)
s.rect((37,61,47,65),'#322b38',OUTLINE);s.rect((40,62,44,64),'#d0a984')
s.end('mascot-pixel.png')

# B — broad little meadow person: uncovered *round peach face*, short leafy hair,
# bell-shaped moss-green coat, horizontal silhouette and warm freckles.
s=Sprite();s.ellipse((11,87,70,92),'#10151a80')
s.poly([(17,51),(28,46),(53,47),(65,54),(72,80),(58,87),(41,85),(23,87),(8,80)],'#668b74')
s.poly([(11,75),(24,83),(41,80),(57,83),(68,74)],'#9ab29b',width=1)
s.poly([(17,53),(27,48),(31,71),(16,75),(11,68)],'#83aa8b')
s.poly([(55,52),(64,58),(70,74),(55,74),(50,63)],'#769782')
s.ellipse((9,63,19,72),PEACH,OUTLINE);s.ellipse((65,65,72,73),PEACH,OUTLINE)
s.poly([(24,81),(34,79),(35,91),(20,91)],'#384b42');s.poly([(47,78),(57,80),(62,91),(47,91)],'#384b42')
s.ellipse((19,10,62,53),'#eabda5',OUTLINE,2)
s.ellipse((22,17,59,49),'#f0cbb0')
s.poly([(19,20),(21,11),(30,6),(44,7),(53,11),(61,18),(59,24),(53,19),(42,22),(28,20)],'#667f61')
s.poly([(13,17),(16,7),(23,9),(31,17),(24,25)],'#8aa17b')
s.poly([(47,9),(54,1),(60,9),(59,20),(51,23)],'#adc39a')
s.rect((29,32,31,37),'#33262e');s.rect((49,32,51,37),'#33262e')
s.rect((26,39,28,40),'#d18d8e');s.rect((53,39,55,40),'#d18d8e')
s.rect((38,40,43,41),'#9b6675');s.p((40,43),'#a87877')
s.poly([(25,56),(39,63),(55,56),(52,61),(40,67),(29,61)],'#c0caa4',width=1)
s.rect((37,69,43,72),'#40594f',OUTLINE)
s.end('mascot-ranger.png')

# C — tall lilac-hair child with very different long, split tunic + exposed face,
# distinct dot-eyes, small mouth, striped ear flaps, no accessories.
s=Sprite();s.ellipse((22,89,60,93),'#0e111580')
s.poly([(28,82),(37,80),(37,91),(27,92)],'#4b384c');s.poly([(47,80),(56,82),(57,92),(47,92)],'#4b384c')
s.poly([(26,48),(38,44),(50,46),(59,50),(63,81),(51,86),(44,79),(36,85),(23,84),(18,69)],'#8d6f9d')
s.poly([(23,71),(36,80),(43,74),(51,81),(60,72)],'#b59abd',width=1)
s.poly([(23,52),(29,57),(23,72),(16,75),(14,62)],'#aa8ab5')
s.poly([(55,52),(62,59),(65,74),(58,76),(52,64)],'#9e7fb0')
s.ellipse((12,64,18,72),PEACH,OUTLINE);s.ellipse((62,64,69,73),PEACH,OUTLINE)
s.poly([(18,21),(21,10),(29,4),(43,5),(57,11),(64,23),(61,42),(52,51),(28,52),(18,43)],'#b47b9f')
s.poly([(17,32),(8,26),(7,39),(19,43)],'#c49bbb')
s.poly([(62,31),(72,27),(71,41),(59,45)],'#c49bbb')
s.ellipse((23,22,58,47),'#e5ac99',OUTLINE)
s.ellipse((26,27,55,45),'#f0c7af')
s.rect((30,33,32,37),'#2f2836');s.rect((48,33,50,37),'#2f2836')
s.p((27,39),'#d59192');s.p((29,41),'#d59192');s.p((53,40),'#d59192')
s.rect((39,41,43,42),'#965c68')
s.poly([(26,21),(20,11),(27,4),(43,2),(57,9),(58,23),(47,20),(39,15),(32,22)],'#66495f')
s.poly([(32,13),(44,8),(53,14),(46,13),(40,21)],'#8f6883',width=1)
s.rect((36,60,46,64),'#473b50',OUTLINE);s.rect((39,61,42,63),'#e4ccb6')
s.end('mascot-lantern.png')

# D — stout little sea-slate figure, asymmetrical floppy hood, tan open
# face, tiny smile, thick short poncho and big paws. Nothing is held.
s=Sprite();s.ellipse((9,87,70,92),'#0e111580')
s.poly([(21,49),(31,46),(56,48),(69,57),(71,79),(61,85),(43,84),(28,85),(11,79),(13,62)],'#536c7a')
s.poly([(13,71),(25,79),(39,77),(52,82),(68,75)],'#83a0a6',width=1)
s.poly([(15,52),(20,52),(25,67),(17,76),(7,70)],'#6d8791')
s.poly([(60,51),(69,55),(74,69),(66,78),(57,68)],'#69848e')
s.ellipse((8,65,16,74),'#a5b4a7',OUTLINE);s.ellipse((69,65,76,74),'#a5b4a7',OUTLINE)
s.poly([(22,80),(33,78),(35,91),(23,91)],'#38444d')
s.poly([(49,78),(59,80),(61,91),(47,91)],'#38444d')
s.poly([(18,20),(24,11),(42,5),(57,8),(66,19),(63,31),(69,41),(61,50),(32,52),(16,42),(13,32)],'#506c79')
s.poly([(17,29),(10,23),(10,13),(18,16),(26,28)],'#78939e')
s.poly([(51,13),(60,10),(70,16),(73,27),(66,32),(58,25)],'#839da2')
s.ellipse((25,24,59,49),'#d4b5a7',OUTLINE)
s.ellipse((28,27,56,47),'#eed4b9')
s.rect((32,33,34,36),'#2f3138');s.rect((49,33,51,36),'#2f3138')
s.rect((38,41,45,42),'#9d727b')
s.poly([(25,50),(34,57),(50,57),(62,50),(58,62),(43,65),(28,62)],'#9eaaa2')
s.poly([(24,50),(38,56),(51,54),(60,51)],'#c3c7b1',width=1)
s.rect((37,70,46,73),'#394d56',OUTLINE)
s.end('mascot-alchemist.png')

if __name__=='__main__':
    print('Generated four differentiated no-prop pixel mascots')
