import { useCallback,useEffect,useRef,useState } from 'react';
import { speechChunks,type Interval } from './document';

export type SpeechOptions={volume:number;rate:number;voiceURI:string;language:string};
export function useSpeech(text:string,bounds:Interval,options:SpeechOptions,onPosition:(n:number)=>void,onError:(message:string)=>void) {
  const [status,setStatus]=useState<'idle'|'playing'|'paused'>('idle');
  const [position,setPosition]=useState(bounds.start);
  const [active,setActive]=useState<Interval|null>(null);
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const generation=useRef(0),cursor=useRef(bounds.start),playing=useRef(false),utterance=useRef<SpeechSynthesisUtterance|null>(null);
  const current=useRef({text,bounds,options,onPosition,onError});
  current.current={text,bounds,options,onPosition,onError};
  const supported=typeof window!=='undefined'&&'speechSynthesis' in window;
  useEffect(()=>{
    if(!supported)return;
    const update=()=>setVoices(window.speechSynthesis.getVoices());
    update();window.speechSynthesis.addEventListener('voiceschanged',update);
    return()=>{generation.current++;window.speechSynthesis.cancel();window.speechSynthesis.removeEventListener('voiceschanged',update);};
  },[supported]);
  const cancel=useCallback(()=>{generation.current++;playing.current=false;if(supported)window.speechSynthesis.cancel();utterance.current=null;},[supported]);
  const startAt=useCallback((at?:number)=>{
    const {text,bounds,options,onError}=current.current;
    if(!supported){onError('Reading aloud is not available in this browser. Try Chrome, Edge, or Safari.');return;}
    cancel();
    const from=Math.max(bounds.start,Math.min(at??cursor.current,bounds.end));
    const chunks=speechChunks(text,from>=bounds.end?bounds.start:from,bounds.end);
    if(!chunks.length){onError('There is no readable text in this range.');return;}
    const token=generation.current;
    playing.current=true;setStatus('playing');
    const speak=(index:number)=>{
      if(token!==generation.current||!playing.current)return;
      const chunk=chunks[index];
      if(!chunk){playing.current=false;setStatus('idle');setActive(null);cursor.current=bounds.start;setPosition(bounds.start);return;}
      cursor.current=chunk.start;setPosition(chunk.start);setActive(chunk);current.current.onPosition(chunk.start);
      const u=new SpeechSynthesisUtterance(chunk.text);
      const voice=window.speechSynthesis.getVoices().find(v=>v.voiceURI===options.voiceURI);
      if(voice)u.voice=voice;
      u.lang=options.language;u.rate=options.rate;u.volume=options.volume;
      u.onboundary=(e)=>{if(token!==generation.current)return;cursor.current=chunk.start+e.charIndex;setPosition(cursor.current);};
      u.onend=()=>{if(token===generation.current)speak(index+1);};
      u.onerror=(e)=>{if(token!==generation.current||e.error==='canceled'||e.error==='interrupted')return;playing.current=false;setStatus('idle');setActive(null);onError('The selected voice could not read this text. Try another available voice.');};
      utterance.current=u;window.speechSynthesis.speak(u);
    };
    speak(0);
  },[cancel,supported]);
  const stop=useCallback(()=>{cancel();cursor.current=current.current.bounds.start;setPosition(cursor.current);setStatus('idle');setActive(null);},[cancel]);
  const pause=useCallback(()=>{cancel();setStatus('paused');setActive(null);},[cancel]);
  const toggle=useCallback(()=>{if(playing.current)pause();else startAt();},[pause,startAt]);
  const seek=useCallback((at:number)=>{const resume=playing.current;cancel();cursor.current=Math.max(current.current.bounds.start,Math.min(at,current.current.bounds.end));setPosition(cursor.current);setActive(null);if(resume)startAt(cursor.current);else setStatus('idle');},[cancel,startAt]);
  useEffect(()=>{stop();},[text,bounds.start,bounds.end,stop]);
  const previousOptions=useRef(options);
  useEffect(()=>{
    const old=previousOptions.current;
    previousOptions.current=options;
    if(old.rate!==options.rate||old.volume!==options.volume||old.voiceURI!==options.voiceURI||old.language!==options.language){if(playing.current)startAt(cursor.current);}
  },[options,startAt]);
  return{status,position,active,voices,supported,toggle,stop,pause,seek,startAt};
}
