import { load } from "cheerio";
import { readFile, writeFile } from "node:fs/promises";
import { createWorker } from "tesseract.js";
const BIOPETROL_ID="10000000-0000-4000-8000-000000000002";
const GENEX_ID="10000000-0000-4000-8000-000000000003";
const GENEX_URL="https://genex.com.bo/estaciones/?3142_tax_product_tag%5B0%5D=314&3142_filtered=true&3142_orderby=option_1";
const RIVERO_ID="10000000-0000-4000-8000-000000000004";
const RIVERO_URL="https://www.estacionrivero.com/index.php?option=com_content&view=category&layout=blog&id=11&Itemid=106";
const GASGROUP_ID="10000000-0000-4000-8000-000000000005";
const GASGROUP_URL="https://gasgroup.com.bo/estaciones/santacruz";
const pages=[{url:"https://app9.biocloud.info/saldos/main/donde/132",fallback:"DIESEL",color:"#3b82f6"},{url:"https://app9.biocloud.info/saldos/main/donde/134",fallback:"GASOLINA ESPECIAL",color:"#ff6900"}];
const correctedCoordinates={LOPEZ:"-17.7255538,-63.1652414"};
const clean=value=>String(value??"").replace(/\s+/g," ").trim();
const numeric=value=>Number(clean(value).replace(/[^0-9.,-]/g,"").replace(/,/g,""))||0;
const slug=value=>clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
async function scrape(page){
  const response=await fetch(page.url,{headers:{"user-agent":"Mozilla/5.0 SaldosCombustible/1.0"}});if(!response.ok)throw new Error(`Biocloud respondió ${response.status}`);
  const $=load(await response.text()),headings=$("h5").map((_,node)=>clean($(node).text())).get();
  const combustible=clean(headings.find(text=>/^Saldos de /i.test(text))?.replace(/^Saldos de /i,""))||page.fallback;
  const ultima=clean(headings.find(text=>/Última medición/i.test(text))?.replace(/^Última medición\s*/i,""));const rows=[];
  $("div.btn-bio-app.rounded").each((_,node)=>{const parts=$(node).children("div"),sucursal=clean(parts.eq(0).text());if(!sucursal)return;const target=parts.eq(7).find("[data-target^='.modal']").attr("data-target")||"",modal=target?$(target):null,onclick=modal?.find("[onclick*='invokeCSCode']").attr("onclick")||"",sourceCoordinates=onclick.match(/invokeCSCode\(['\"]([^'\"]+)/)?.[1]||"",coordinates=correctedCoordinates[sucursal]||sourceCoordinates,iframe=modal?.find("iframe").attr("src")||"",rawPlace=iframe.match(/!2s([^!]+)/)?.[1]||"",placeName=rawPlace?decodeURIComponent(rawPlace.replace(/\+/g," ")):"",direccion=clean(parts.eq(7).find(".px-1.col-12").first().text()),directUrl=coordinates?`https://www.google.com/maps?q=${coordinates}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean(`${placeName||`Biopetrol ${sucursal}`} ${direccion}`))}`;rows.push({id_empresa:BIOPETROL_ID,id_sucursal:`biopetrol-${slug(sucursal)}`,sucursal,direccion,id_producto:`biopetrol-${slug(combustible)}`,combustible,color:page.color,saldo_litros:numeric(parts.eq(2).text()),capacidad_litros:null,vehiculos:numeric(parts.eq(4).text()),minutos:numeric(parts.eq(6).text()),ultima_medicion:ultima,coordenadas:coordinates,nombre_google:placeName,map_url:directUrl,fuente:page.url,source_scraping:true});});return rows;
}
async function scrapeGenex(){
  const response=await fetch(GENEX_URL,{headers:{"user-agent":"Mozilla/5.0 SaldosCombustible/1.0"}});if(!response.ok)throw new Error(`GENEX respondió ${response.status}`);
  const $=load(await response.text()),rows=[];
  $(".wcpt-row[data-wcpt-product-id]").each((_,node)=>{
    const station=$(node),sucursal=clean(station.find(".station_name").first().text());if(!sucursal)return;
    const idSucursal=`genex-${station.attr("data-wcpt-product-id")||slug(sucursal)}`,direccion=clean(station.find(".station_address").first().text()),ultima=clean(station.find(".station_updated").first().text()),mapa=station.find(".station_map a").attr("href")||"";
    station.find(".product_wrapper").each((__,productNode)=>{
      const product=$(productNode),combustible=clean(product.find(".product_name").first().text()),volume=clean(product.find(".product_volume").first().text());if(!combustible)return;
      const agotado=/AGOTADO/i.test(volume),disponible=/DISPONIBLE/i.test(volume),queue=clean(product.find(".product_queue").first().text());
      rows.push({id_empresa:GENEX_ID,id_sucursal:idSucursal,sucursal,direccion,id_producto:`genex-${slug(combustible)}`,combustible,color:combustible.includes("DIESEL")?"#3b82f6":combustible.includes("GAS")?"#16a34a":"#ef4444",saldo_litros:/litros/i.test(volume)?numeric(volume):0,capacidad_litros:null,estado:agotado?"AGOTADO":disponible?"DISPONIBLE":"CON STOCK",detalle_cola:queue,ultima_medicion:ultima,map_url:mapa,fuente:GENEX_URL,source_scraping:true});
    });
  });return rows;
}
async function scrapeRivero(){
  const response=await fetch(RIVERO_URL,{headers:{"user-agent":"Mozilla/5.0 SaldosCombustible/1.0"}});if(!response.ok)throw new Error(`Rivero respondió ${response.status}`);
  const $=load(await response.text()),charts=[];
  $(".blog-item").each((_,node)=>{const title=clean($(node).find("h2").first().text()).replace(/^Saldos\s+/i,"");const src=$(node).find("iframe[src*='pubchart']").first().attr("src");if(title&&src)charts.push({title,src:src.replace(/&amp;/g,"&")});});
  const updateSrc=$("iframe[src*='oid=970629425']").first().attr("src")?.replace(/&amp;/g,"&");
  const worker=await createWorker("spa");
  try{let updated="";if(updateSrc){const text=(await worker.recognize(updateSrc)).data.text;const date=text.match(/\d{1,2}\/\d{1,2}\/\d{4}/)?.[0]||"",time=text.match(/\d{1,2}:\d{2}/)?.[0]||"";updated=clean(`${date} ${time}`);}
    const rows=[];for(const chart of charts){const text=(await worker.recognize(chart.src)).data.text,lines=text.split(/\r?\n/).map(clean).filter(Boolean),lastLine=lines.at(-1)||"",liters=/^[o0]\s*litros?$/i.test(lastLine)?0:numeric(lastLine);rows.push({id_empresa:RIVERO_ID,id_sucursal:"rivero-central",sucursal:"Estación de Servicio Rivero",direccion:"Av. Cristo Redentor esquina Medardo Chávez, Santa Cruz de la Sierra",id_producto:`rivero-${slug(chart.title)}`,combustible:chart.title,color:chart.title.includes("DIESEL")?"#3b82f6":chart.title.includes("PREMIUM")?"#7c3aed":"#ef4444",saldo_litros:liters,capacidad_litros:null,estado:liters>0?"CON STOCK":"AGOTADO",ultima_medicion:updated,coordenadas:"-17.7624684,-63.1804821",map_url:"https://www.google.com/maps?q=-17.7624684,-63.1804821",fuente:RIVERO_URL,source_scraping:true});}return rows;
  }finally{await worker.terminate();}
}
async function scrapeGasgroup(){
  const response=await fetch(GASGROUP_URL,{headers:{accept:"application/json","x-requested-with":"XMLHttpRequest","user-agent":"Mozilla/5.0 SaldosCombustible/1.0"}});if(!response.ok)throw new Error(`GASGROUP respondió ${response.status}`);
  const data=await response.json(),rows=[];
  for(const station of data.estaciones||[]){
    const sucursal=clean(station.nombre);if(!sucursal)continue;
    const grouped=new Map();
    for(const tank of station.tanques||[]){
      if(!/gasolina/i.test(tank.producto||""))continue;
      const combustible=clean(tank.producto).replace(/\s*\+\s*$/," +"),key=slug(combustible),previous=grouped.get(key)||{combustible,saldo:0,measurements:[]};
      previous.saldo+=Number(tank.litros)||0;previous.measurements.push(clean(`${tank.fecha||""} ${tank.hora||""}`));grouped.set(key,previous);
    }
    const longitude=String(station.mapa_url||"").match(/!2d(-?\d+(?:\.\d+)?)/)?.[1],latitude=String(station.mapa_url||"").match(/!3d(-?\d+(?:\.\d+)?)/)?.[1],coordinates=latitude&&longitude?`${latitude},${longitude}`:"";
    for(const [key,product] of grouped)rows.push({id_empresa:GASGROUP_ID,id_sucursal:`gasgroup-${slug(station.codigo||sucursal)}`,sucursal,direccion:"Santa Cruz de la Sierra",id_producto:`gasgroup-${key}`,combustible:product.combustible,color:"#ef4444",saldo_litros:Number(product.saldo.toFixed(2)),capacidad_litros:null,estado:product.saldo>1500?"CON STOCK":"AGOTADO",ultima_medicion:product.measurements.sort().at(-1)||"",coordenadas:coordinates,map_url:coordinates?`https://www.google.com/maps?q=${coordinates}`:"",fuente:GASGROUP_URL,source_scraping:true});
  }
  return rows;
}
const target="external-data.json";
let previous={balances:[]};try{previous=JSON.parse(await readFile(target,"utf8"));}catch{previous=JSON.parse(await readFile("data.json","utf8"));}
const previousExternal=id=>(previous.balances||[]).filter(row=>row.id_empresa===id);
async function preserve(name,id,task){try{const rows=await task();if(!rows.length)throw new Error("respuesta vacía");return rows;}catch(error){const rows=previousExternal(id);console.error(`${name}: ${error.message}; se conservan ${rows.length} filas anteriores.`);return rows;}}
const biopetrol=await preserve("Biopetrol",BIOPETROL_ID,async()=>(await Promise.all(pages.map(scrape))).flat()),genex=await preserve("GENEX",GENEX_ID,scrapeGenex),rivero=await preserve("Rivero",RIVERO_ID,scrapeRivero),gasgroup=await preserve("GASGROUP",GASGROUP_ID,scrapeGasgroup);
await writeFile(target,JSON.stringify({generatedAt:new Date().toISOString(),balances:[...biopetrol,...genex,...rivero,...gasgroup]},null,2));
console.log(`Lecturas externas: ${biopetrol.length} Biopetrol, ${genex.length} GENEX, ${rivero.length} Rivero, ${gasgroup.length} GASGROUP`);

