'use client';
import {useEffect,useRef,useState} from 'react';
import {FrameCache,frameOrder} from './frame-cache';
import styles from '../scene-one.module.css';

export default function CanvasScene(){
 const root=useRef<HTMLElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [ready,setReady]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{
  const element=root.current!,surface=canvas.current!,ctx=surface.getContext('2d',{alpha:false});
  if(!ctx){setFailed(true);return;}
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const mobile=matchMedia('(max-width:900px)').matches;
  surface.width=mobile?960:1440;surface.height=mobile?540:810;
  const cache=new FrameCache<ImageBitmap>(mobile?24:12),pending=new Map<number,AbortController>(),errors=new Set<number>();
  let disposed=false,target=0,display=0,last=-1,raf=0,time=0,draws=0;
  let cleanup:(()=>void)|undefined;
  const count=364;
  const schedule=()=>{if(!disposed&&!raf)raf=requestAnimationFrame(tick);};
  function pump(){
   if(disposed)return;
   const order=frameOrder(target,count,mobile?8:5);
   for(const [key,request] of pending)if(Math.abs(key-target)>24){request.abort();pending.delete(key);}
   for(const index of order){
    if(pending.size>=4)break;
    if(cache.entries.has(index)||pending.has(index)||errors.has(index))continue;
    const controller=new AbortController();pending.set(index,controller);
    void fetch(`/frames/scene01/${mobile?'mobile':'desktop'}/${String(index).padStart(4,'0')}.webp`,{signal:controller.signal})
     .then(response=>{if(!response.ok)throw Error('Frame unavailable');return response.blob();})
     .then(blob=>createImageBitmap(blob)).then(bitmap=>{
      if(disposed||controller.signal.aborted){bitmap.close();return;}
      cache.put(index,bitmap,target);schedule();
     }).catch(()=>{if(!disposed&&!controller.signal.aborted){errors.add(index);if(errors.size>12&&!draws)setFailed(true);}})
     .finally(()=>{if(pending.get(index)===controller)pending.delete(index);if(!disposed){pump();schedule();}});
   }
  }
  function tick(now:number){
   raf=0;if(disposed)return;
   const delta=time?Math.min((now-time)/1000,.05):1/60;time=now;
   display+=(target-display)*(1-Math.exp(-18*delta));
   if(Math.abs(target-display)<.1)display=target;
   let frame=Math.round(display);
   if(!cache.entries.has(frame)){
    // Fast jumps favor the requested destination, never a blank canvas.
    const candidates=[...cache.entries.keys()].filter(key=>Math.abs(key-target)<Math.abs(last-target));
    if(candidates.length)frame=candidates.reduce((a,b)=>Math.abs(a-target)<Math.abs(b-target)?a:b);
   }
   const bitmap=cache.entries.get(frame);
   if(bitmap&&frame!==last){ctx!.drawImage(bitmap,0,0,surface.width,surface.height);last=frame;draws++;setReady(true);}
   element.dataset.frame=String(last);element.dataset.target=String(Math.round(target));element.dataset.cache=String(cache.entries.size);element.dataset.draws=String(draws);
   if(Math.abs(display-target)>.1)schedule();
  }
  pump();
  void Promise.all([import('gsap'),import('gsap/ScrollTrigger')]).then(([{gsap},{ScrollTrigger}])=>{
   if(disposed)return;gsap.registerPlugin(ScrollTrigger);
   const update=(progress:number)=>{target=progress*(count-1);pump();schedule();};
   const trigger=ScrollTrigger.create({trigger:element,start:'top top',end:'bottom bottom',onUpdate:self=>update(self.progress),onRefresh:self=>update(self.progress)});
   update(trigger.progress);cleanup=()=>trigger.kill();
  }).catch(()=>{if(!disposed)setFailed(true);});
  return()=>{disposed=true;cleanup?.();cancelAnimationFrame(raf);for(const request of pending.values())request.abort();pending.clear();cache.clear();};
 },[]);
 return <section ref={root} id="services" tabIndex={-1} className={styles.scene} aria-label="Navair: from runway to sky" data-player="canvas" data-failed={failed}>
  <div className={styles.stage}><div className={styles.film}>
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img className={styles.poster} src="/video/scene01-poster.jpg" alt="Navair aircraft on the runway"/>
   <canvas ref={canvas} className={styles.video} data-ready={ready} aria-hidden="true"/>
  </div><div className={styles.caption}><span>NAVAIR · 01</span><h2>Every journey begins<br/>with a clear direction.</h2></div></div>
 </section>;
}
