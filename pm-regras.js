/* Regras de transporte de máquinas (pesos/dimensões por classe, limites legais) — partilhadas */
var PMR=(function(){
const CLASS_SPECS = {
  'Escavadora de rastos':   {peso:22000, c:9.5,  l:2.9,  a:3.2},
  'Escavadora de pneus':    {peso:20000, c:9.5,  l:2.55, a:3.3},
  'Pá carregadora':         {peso:18000, c:8.5,  l:3.0,  a:3.5},
  'Dumper articulado':      {peso:24000, c:10.5, l:3.3,  a:3.6},
  'Bulldozer':              {peso:20000, c:6.0,  l:3.4,  a:3.2},
  'Motoniveladora':         {peso:16000, c:9.5,  l:2.6,  a:3.3},
  'Retroescavadora':        {peso:8500,  c:5.9,  l:2.4,  a:3.1},
  'Bobcat':                 {peso:3500,  c:3.6,  l:1.9,  a:2.1},
  'Cilindro':               {peso:9000,  c:5.0,  l:2.3,  a:3.0},
  'Pavimentadora':          {peso:19000, c:6.5,  l:2.55, a:3.1},
  'Fresadora':              {peso:30000, c:11.0, l:2.6,  a:3.2},
  'Plataforma elevatória':  {peso:7000,  c:6.5,  l:2.3,  a:2.6},
  'Manitou / Telescópica':  {peso:11000, c:6.0,  l:2.4,  a:2.6},
  'Britador móvel':         {peso:38000, c:14.0, l:3.0,  a:3.6},
  'Crivo móvel':            {peso:34000, c:16.0, l:3.0,  a:3.9},
  'Equip. perfuração':      {peso:15000, c:9.0,  l:2.6,  a:3.4},
  'Empilhador':             {peso:5000,  c:4.5,  l:2.3,  a:2.4},
  'Tractor agrícola':       {peso:6000,  c:4.8,  l:2.5,  a:3.0},
  'Varredora':              {peso:5000,  c:5.5,  l:2.3,  a:2.6},
  'Máquina de valetas':     {peso:9000,  c:6.5,  l:2.5,  a:3.2},
  'Triturador':             {peso:20000, c:8.0,  l:2.6,  a:3.4},
  'Auto-betoneira':         {peso:12000, c:7.0,  l:2.5,  a:3.5},
  'Grua':                   {peso:24000, c:12.0, l:2.6,  a:3.8},
  'Outra máquina':          {peso:12000, c:7.0,  l:2.55, a:3.2}
};
const MODEL_OVERRIDES = [
  [/EC\s*140/i,{peso:14000}],[/EC\s*160/i,{peso:16500}],[/EC\s*200/i,{peso:20000}],
  [/EC\s*220/i,{peso:22500,c:9.7,l:2.9,a:3.2}],[/EC\s*250/i,{peso:25000}],[/EC\s*300/i,{peso:30000}],
  [/EC\s*360/i,{peso:36500,c:10.9,l:3.3,a:3.4}],[/EC\s*400/i,{peso:40000,c:11.2,l:3.4,a:3.5}],
  [/EC\s*480/i,{peso:48000,c:11.4,l:3.4,a:3.5}],[/EC\s*490/i,{peso:49500,c:11.4,l:3.4,a:3.5}],
  [/EC\s*750/i,{peso:73000,c:12.5,l:3.7,a:4.0}],
  [/\b220\b/i,{peso:22000}],[/\b240\b/i,{peso:24000}],
  [/L\s*90/i,{peso:15000}],[/L\s*120/i,{peso:19000}],[/L\s*150/i,{peso:24000}],
  [/L\s*180/i,{peso:27500,c:9.0,l:3.1,a:3.6}],[/L\s*220/i,{peso:32000,c:9.5,l:3.2,a:3.7}],
  [/A\s*25/i,{peso:21500,c:10.2,l:3.0,a:3.5}],[/A\s*30/i,{peso:23500,c:10.6,l:3.2,a:3.6}],
  [/A\s*35/i,{peso:29000,c:11.2,l:3.4,a:3.7}],[/A\s*40/i,{peso:31000,c:11.5,l:3.5,a:3.8}],
  [/D6/i,{peso:20000,c:6.2,l:3.4,a:3.2}],[/D8/i,{peso:38000,c:7.5,l:3.6,a:3.5}],
  [/HD\s*\+?\s*13/i,{peso:2700,c:2.6,l:1.4,a:2.6}],[/HD\s*\+?\s*14/i,{peso:3800,c:3.0,l:1.5,a:2.7}],
  [/HD\s*\+?\s*70/i,{peso:7200}],[/HD\s*\+?\s*90/i,{peso:9500}],[/HD\s*\+?\s*110/i,{peso:11500}],
  [/GRW\s*18/i,{peso:18500,c:6.6,l:2.3,a:3.1}],
  [/Super\s*800/i,{peso:8000,c:5.2,l:2.4,a:2.9}],[/Super\s*1800/i,{peso:19000,c:6.4,l:2.55,a:3.1}],
  [/Super\s*2100/i,{peso:23000,c:7.0,l:3.0,a:3.4}],
  [/W\s*200/i,{peso:30500,c:11.2,l:2.6,a:3.2}],[/W\s*100/i,{peso:19000}],
  [/MRT\s*14/i,{peso:11000,c:6.0,l:2.4,a:2.6}],[/MRT\s*21/i,{peso:13500,c:6.5,l:2.5,a:2.7}],
  [/3\s*CX/i,{peso:8200,c:5.9,l:2.35,a:2.95}],[/4\s*CX/i,{peso:9000,a:3.0}],
  [/R220/i,{peso:3600,c:3.6,l:1.9,a:2.1}],[/V230/i,{peso:3900}],[/V420/i,{peso:4300}],
  [/Kleemann|MR100|MSS502/i,{peso:37000,c:14.5,l:3.0,a:3.6}],[/Extec|C12/i,{peso:36000,c:13.5,l:2.75,a:3.4}]
];
const DEFAULT_LEGAL = {
  larg_normal:2.55, larg_espec:3.00, larg_excec:3.50,
  alt_normal:4.00,  alt_espec:4.50,  alt_excec:4.50,
  comp_normal:18.75,comp_espec:25.0, comp_excec:30.0,
  peso_normal:44000,peso_espec:60000,peso_excec:60000,
  piloto_larg:3.00, piloto_alt:4.50, piloto_comp:25.0, piloto_peso:48000,
  piloto2_larg:4.50, piloto2_comp:30.0
};
const DL195_DATA='2027-03-24', DL195_ALT=4.25;
return {CLASS_SPECS,MODEL_OVERRIDES,DEFAULT_LEGAL,DL195_DATA,DL195_ALT};
})();
