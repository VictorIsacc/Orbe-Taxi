(() => {
  "use strict";
  const R = 6378137, TILE = 256, SVG_NS = "http://www.w3.org/2000/svg";
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const latLng = value => Array.isArray(value)
    ? {lat:+value[0],lng:+value[1]}
    : {lat:+(value.lat ?? value.latitude),lng:+(value.lng ?? value.lon ?? value.longitude)};
  const project = (value,zoom) => {
    const point=latLng(value), scale=2**zoom;
    const x=(point.lng+180)/360*scale*TILE;
    const sine=Math.sin(clamp(point.lat,-85.05112878,85.05112878)*Math.PI/180);
    const y=(.5-Math.log((1+sine)/(1-sine))/(4*Math.PI))*scale*TILE;
    return {x,y};
  };
  const unproject = (point,zoom) => {
    const scale=2**zoom*TILE, lng=point.x/scale*360-180, y=Math.PI-2*Math.PI*point.y/scale;
    return {lat:180/Math.PI*Math.atan(.5*(Math.exp(y)-Math.exp(-y))),lng};
  };
  const metersPerPixel = (lat,zoom) => Math.cos(lat*Math.PI/180)*2*Math.PI*R/(TILE*2**zoom);

  class LiteMap {
    constructor(id,options={}) {
      this.el=typeof id==="string"?document.getElementById(id):id;
      this.options=options; this.center={lat:37.1769,lng:-3.5977}; this.zoom=15; this.layers=[]; this.tileLayer=null;
      this.el.classList.add("leaflet-container","lite-map");
      this.viewport=document.createElement("div"); this.viewport.className="lite-map-viewport";
      this.tiles=document.createElement("div"); this.tiles.className="lite-map-tiles";
      this.overlays=document.createElement("div"); this.overlays.className="lite-map-overlays";
      this.attribution=document.createElement("div"); this.attribution.className="leaflet-control-attribution";
      this.attribution.innerHTML='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
      this.viewport.append(this.tiles,this.overlays); this.el.replaceChildren(this.viewport,this.attribution);
      this._ready=false; this._renderQueued=false; this._drag=null; this._wire();
      requestAnimationFrame(()=>{this._ready=true;this.render();});
    }
    _wire() {
      this.el.addEventListener("wheel",event=>{
        event.preventDefault();
        this.setView(this.center,clamp(this.zoom+(event.deltaY<0?1:-1),3,19));
      },{passive:false});
      this.el.addEventListener("pointerdown",event=>{
        this._drag={x:event.clientX,y:event.clientY,start:project(this.center,this.zoom)};
        this.el.setPointerCapture?.(event.pointerId);
      });
      this.el.addEventListener("pointermove",event=>{
        if(!this._drag)return;
        const dx=event.clientX-this._drag.x,dy=event.clientY-this._drag.y;
        this.center=unproject({x:this._drag.start.x-dx,y:this._drag.start.y-dy},this.zoom);
        this.render();
      });
      const end=()=>{this._drag=null;};
      this.el.addEventListener("pointerup",end); this.el.addEventListener("pointercancel",end);
    }
    setView(center,zoom=this.zoom){this.center=latLng(center);this.zoom=clamp(Math.round(zoom),3,19);this.render();return this;}
    panTo(center){return this.setView(center,this.zoom);}
    flyTo(center,zoom=this.zoom){
      if(center && !Array.isArray(center) && Array.isArray(center.center)) return this.setView([center.center[1],center.center[0]],center.zoom ?? zoom);
      return this.setView(center,zoom);
    }
    fitBounds(bounds){
      const box=bounds._bounds||bounds,rect=this.el.getBoundingClientRect();
      for(let zoom=19;zoom>=3;zoom--){
        const a=project({lat:box.south,lng:box.west},zoom),b=project({lat:box.north,lng:box.east},zoom);
        if(Math.abs(b.x-a.x)<=rect.width*.72&&Math.abs(b.y-a.y)<=rect.height*.55){this.zoom=zoom;break;}
      }
      return this.setView([(box.south+box.north)/2,(box.west+box.east)/2],this.zoom);
    }
    invalidateSize(){this.render();return this;}
    whenReady(callback){if(this._ready)callback();else requestAnimationFrame(callback);return this;}
    addLayer(layer){if(!this.layers.includes(layer))this.layers.push(layer);layer._map=this;this.overlays.appendChild(layer.el);layer.update();return this;}
    removeLayer(layer){this.layers=this.layers.filter(item=>item!==layer);layer?.el?.remove();if(layer)layer._map=null;return this;}
    render(){if(this._renderQueued)return;this._renderQueued=true;requestAnimationFrame(()=>{this._renderQueued=false;this._renderTiles();this.layers.forEach(layer=>layer.update());});}
    _renderTiles(){
      const rect=this.el.getBoundingClientRect(); if(!rect.width||!rect.height)return;
      const center=project(this.center,this.zoom),left=center.x-rect.width/2,top=center.y-rect.height/2;
      const x0=Math.floor(left/TILE),x1=Math.floor((left+rect.width)/TILE),y0=Math.floor(top/TILE),y1=Math.floor((top+rect.height)/TILE);
      const needed=new Set(),count=2**this.zoom;
      const template=this.tileLayer?.url||"https://tile.openstreetmap.org/{z}/{x}/{y}.png";
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        if(y<0||y>=count)continue;
        const wrapped=((x%count)+count)%count,key=`${this.zoom}/${wrapped}/${y}`; needed.add(key);
        let image=this.tiles.querySelector(`[data-key="${key}"]`);
        if(!image){
          image=new Image(); image.dataset.key=key; image.alt=""; image.decoding="async"; image.loading="eager";
          image.className="lite-map-tile"; image.referrerPolicy="no-referrer";
          image.src=template.replace("{z}",this.zoom).replace("{x}",wrapped).replace("{y}",y);
          const timer=setTimeout(()=>{if(!image.complete){image.removeAttribute("src");image.classList.add("tile-timeout");}},10000);
          image.onload=()=>clearTimeout(timer);
          image.onerror=()=>{clearTimeout(timer);image.classList.add("tile-error");this.tileLayer?.handlers?.tileerror?.({tile:image});};
          this.tiles.appendChild(image);
        }
        image.style.transform=`translate3d(${x*TILE-left}px,${y*TILE-top}px,0)`;
      }
      this.tiles.querySelectorAll("img[data-key]").forEach(image=>{if(!needed.has(image.dataset.key))image.remove();});
    }
    pointFor(value){
      const rect=this.el.getBoundingClientRect(),center=project(this.center,this.zoom),point=project(value,this.zoom);
      return {x:rect.width/2+point.x-center.x,y:rect.height/2+point.y-center.y};
    }
  }

  class DivIcon{constructor(options={}){Object.assign(this,options);}}
  class Marker{
    constructor(value,options={}){
      this.ll=latLng(value);this.options=options;this.el=document.createElement("div");this.el.className="lite-marker";
      const icon=options.icon||{};this.el.innerHTML=icon.html||"";if(icon.className)this.el.classList.add(icon.className);
      this.anchor=icon.iconAnchor||[8,8];this.el.style.zIndex=String(500+(options.zIndexOffset||0));
    }
    addTo(map){map.addLayer(this);return this;} setLatLng(value){this.ll=latLng(value);this.update();return this;}
    remove(){this._map?.removeLayer(this);return this;} getElement(){return this.el.firstElementChild||this.el;}
    bindTooltip(text){this.el.title=text;return this;} on(type,handler){this.el.addEventListener(type,handler);return this;}
    update(){if(!this._map)return;const point=this._map.pointFor(this.ll);this.el.style.transform=`translate3d(${point.x-this.anchor[0]}px,${point.y-this.anchor[1]}px,0)`;}
  }
  class Circle{
    constructor(value,options={}){
      this.ll=latLng(value);this.options=options;this.radius=options.radius||0;this.el=document.createElement("div");this.el.className="lite-circle";
      Object.assign(this.el.style,{border:`${options.weight||1}px solid ${options.color||'#61e7ff'}`,background:options.fillColor||'#61e7ff',opacity:String(options.fillOpacity??.08)});
    }
    addTo(map){map.addLayer(this);return this;} setLatLng(value){this.ll=latLng(value);this.update();return this;} setRadius(radius){this.radius=radius;this.update();return this;}
    remove(){this._map?.removeLayer(this);return this;}
    update(){if(!this._map)return;const point=this._map.pointFor(this.ll),pixels=Math.max(4,this.radius/metersPerPixel(this.ll.lat,this._map.zoom));this.el.style.width=`${pixels*2}px`;this.el.style.height=`${pixels*2}px`;this.el.style.transform=`translate3d(${point.x-pixels}px,${point.y-pixels}px,0)`;}
  }
  class Polyline{
    constructor(points,options={}){
      this.points=points.map(latLng);this.options=options;this.el=document.createElementNS(SVG_NS,"svg");this.el.classList.add("lite-polyline");
      this.line=document.createElementNS(SVG_NS,"polyline");this.line.setAttribute("fill","none");this.line.setAttribute("stroke-linecap","round");this.line.setAttribute("stroke-linejoin","round");
      this.el.appendChild(this.line);this.setStyle(options);
    }
    addTo(map){map.addLayer(this);return this;} remove(){this._map?.removeLayer(this);return this;}
    setStyle(options={}){Object.assign(this.options,options);this.line.setAttribute("stroke",this.options.color||"#0b8f5b");this.line.setAttribute("stroke-width",String(this.options.weight||4));this.line.setAttribute("stroke-opacity",String(this.options.opacity??.8));return this;}
    update(){if(!this._map)return;this.line.setAttribute("points",this.points.map(value=>{const point=this._map.pointFor(value);return `${point.x},${point.y}`;}).join(" "));}
  }
  class Bounds{
    constructor(points){const values=points.map(latLng);this._bounds={south:Math.min(...values.map(p=>p.lat)),north:Math.max(...values.map(p=>p.lat)),west:Math.min(...values.map(p=>p.lng)),east:Math.max(...values.map(p=>p.lng))};}
    pad(ratio){const box=this._bounds,dy=(box.north-box.south)||.002,dx=(box.east-box.west)||.002;return new Bounds([[box.south-dy*ratio,box.west-dx*ratio],[box.north+dy*ratio,box.east+dx*ratio]]);}
  }
  class TileLayer{constructor(url,options={}){this.url=url;this.options=options;this.handlers={};}addTo(map){map.tileLayer=this;map.render();return this;}on(type,handler){this.handlers[type]=handler;return this;}}
  const control={zoom:()=>({addTo(map){const box=document.createElement("div");box.className="lite-zoom";const plus=document.createElement("button"),minus=document.createElement("button");plus.type=minus.type="button";plus.textContent="+";minus.textContent="−";plus.onclick=()=>map.setView(map.center,map.zoom+1);minus.onclick=()=>map.setView(map.center,map.zoom-1);box.append(plus,minus);map.el.appendChild(box);return this;}})};
  window.L={map:(id,options)=>new LiteMap(id,options),tileLayer:(url,options)=>new TileLayer(url,options),divIcon:options=>new DivIcon(options),marker:(value,options)=>new Marker(value,options),circle:(value,options)=>new Circle(value,options),polyline:(points,options)=>new Polyline(points,options),latLngBounds:points=>new Bounds(points),control};
})();
