import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { BookOpen,Upload,Headphones,Play,Pause,Square,ChevronLeft,ChevronRight,Volume2,VolumeX,Sparkles,ScanText,BookMarked,X,Check,Search,FileText,Minus,Plus,RotateCcw,ShieldCheck,LoaderCircle,Highlighter,Flag,MapPin,Settings2 } from 'lucide-react';
import { sampleBook,readPdf,selectionInterval,type Book,type Interval } from './document';
import { useSpeech,type SpeechOptions } from './useSpeech';

const languageLabels:Record<string,string>={'en-US':'English (US)','en-GB':'English (UK)','es-ES':'Español','fr-FR':'Français','de-DE':'Deutsch','it-IT':'Italiano','pt-BR':'Português','ja-JP':'日本語','ko-KR':'한국어','zh-CN':'中文','hi-IN':'हिन्दी','ar-SA':'العربية'};
const words=(text:string)=>text.trim().split(/\s+/u).filter(Boolean).length;
type Insight={title:string;text:string;source:string;url?:string;kind:'summary'|'definition';scope:string};
type Tool='define'|'selection'|'through';

function TextSurface({text,start,selected,active}:{text:string;start:number;selected:Interval|null;active:Interval|null}){
  const edges=new Set([0,text.length]);
  for(const interval of [selected,active])if(interval){edges.add(Math.max(0,Math.min(text.length,interval.start-start)));edges.add(Math.max(0,Math.min(text.length,interval.end-start)));}
  const points=[...edges].sort((a,b)=>a-b);
  return <>{points.slice(0,-1).map((p,i)=>{
    const end=points[i+1];const position=start+p;
    const chosen=selected&&position>=selected.start&&position<selected.end;
    const speaking=active&&position>=active.start&&position<active.end;
    return <span key={`${p}:${end}`} className={chosen?'chosen-text':speaking?'spoken-text':undefined}>{text.slice(p,end)}</span>;
  })}</>;
}

export default function App(){
  const [book,setBook]=useState<Book>(sampleBook),[pageIndex,setPageIndex]=useState(0);
  const [bounds,setBounds]=useState<Interval>({start:0,end:sampleBook.text.length});
  const [selection,setSelection]=useState<Interval|null>(null);
  const [options,setOptions]=useState<SpeechOptions>({volume:.8,rate:1,voiceURI:'',language:'en-US'});
  const [fontSize,setFontSize]=useState(20),[loading,setLoading]=useState(''),[dragging,setDragging]=useState(false);
  const [notice,setNotice]=useState(''),[insight,setInsight]=useState<Insight|null>(null),[aiStatus,setAiStatus]=useState('');
  const [aiReady,setAiReady]=useState(false),[autoPlay,setAutoPlay]=useState(true),[tool,setTool]=useState<Tool>('selection');
  const fileInput=useRef<HTMLInputElement>(null),reader=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null);
  const upload=useRef<AbortController|null>(null),worker=useRef<Worker|null>(null),requestId=useRef(0),dictionaryAbort=useRef<AbortController|null>(null),pendingInsight=useRef<Omit<Insight,'text'>|null>(null);
  const pendingAutoPlay=useRef(false);
  const notify=useCallback((message:string)=>setNotice(message),[]);
  const onPosition=useCallback((at:number)=>{const next=book.pages.findIndex(p=>at>=p.start&&at<=p.end);if(next>=0)setPageIndex(next);},[book]);
  const speech=useSpeech(book.text,bounds,options,onPosition,notify);
  const page=book.pages[pageIndex];
  const selectedText=selection?book.text.slice(selection.start,selection.end):'';
  const startPage=book.pages.findIndex(p=>bounds.start>=p.start&&bounds.start<=p.end)+1;
  const endPage=Math.max(1,book.pages.findIndex(p=>bounds.end>=p.start&&bounds.end<=p.end)+1);
  const languageOptions=useMemo(()=>Array.from(new Set([...Object.keys(languageLabels),...speech.voices.map(v=>v.lang)])).sort(),[speech.voices]);
  const matchingVoices=speech.voices.filter(v=>v.lang===options.language||v.lang.split('-')[0]===options.language.split('-')[0]);
  const totalMinutes=Math.max(1,Math.ceil(words(book.text)/(160*options.rate)));
  const progress=Math.max(0,Math.min(100,(speech.position-bounds.start)/(bounds.end-bounds.start)*100));
  const boundedMinutes=Math.max(1,Math.ceil(words(book.text.slice(bounds.start,bounds.end))/(160*options.rate)));

  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),7000);return()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{scroll.current?.scrollTo({top:0,behavior:'smooth'});},[pageIndex,book]);
  useEffect(()=>{if(pendingAutoPlay.current){pendingAutoPlay.current=false;const t=setTimeout(()=>speech.startAt(0),150);return()=>clearTimeout(t);}},[book,speech.startAt]);
  useEffect(()=>()=>{upload.current?.abort();worker.current?.terminate();dictionaryAbort.current?.abort();},[]);

  const captureSelection=useCallback(()=>{
    if(!reader.current)return;
    const interval=selectionInterval(reader.current);
    if(interval&&book.text.slice(interval.start,interval.end).trim())setSelection(interval);
  },[book]);

  const cancelAI=useCallback(()=>{
    requestId.current++;worker.current?.terminate();worker.current=null;dictionaryAbort.current?.abort();setAiStatus('');setAiReady(false);
  },[]);
  const openFile=useCallback(async(file:File)=>{
    upload.current?.abort();const controller=new AbortController();upload.current=controller;
    speech.stop();cancelAI();setLoading('Opening your PDF…');
    try{
      const next=await readPdf(file,(n,total)=>{if(!controller.signal.aborted)setLoading(`Reading page ${n} of ${total}…`);},controller.signal);
      if(controller.signal.aborted)return;
      setBook(next);setBounds({start:0,end:next.text.length});setPageIndex(0);setSelection(null);setInsight(null);setLoading('');pendingAutoPlay.current=autoPlay;
      notify(autoPlay?'Your PDF is ready. Starting playback…':'Your PDF is ready to read.');
    }catch(e){if(!controller.signal.aborted){setLoading('');notify(e instanceof Error?e.message:'This PDF could not be opened. Try another file.');}}
  },[speech.stop,cancelAI,autoPlay,notify]);

  function neural(action:'summary'|'define',text:string,meta:Omit<Insight,'text'>){
    const id=++requestId.current;pendingInsight.current=meta;
    if(!worker.current){
      worker.current=new Worker(new URL('./ai.worker.ts',import.meta.url),{type:'module'});
      worker.current.onmessage=({data})=>{
        if(data.id!==requestId.current)return;
        if(data.type==='progress')setAiStatus(data.message);
        if(data.type==='result'){setInsight({...pendingInsight.current!,text:data.result});setAiStatus('');setAiReady(true);}
        if(data.type==='error'){setAiStatus('');notify(data.message);}
      };
      worker.current.onerror=()=>{setAiStatus('');worker.current?.terminate();worker.current=null;notify('The neural model could not start in this browser. Try Chrome or Edge on a desktop device.');};
    }
    setAiStatus(aiReady?'Working on your text…':'Preparing the neural model…');
    const context=selection?book.text.slice(Math.max(0,selection.start-500),selection.end+500):text;
    worker.current.postMessage({id,action,text,context});
  }

  async function runTool(chosen=tool){
    if(!selection||!selectedText.trim()){notify('Highlight a word or passage in the reading area first.');return;}
    if(aiStatus)return;
    if(chosen==='define'){
      if(words(selectedText)>12){notify('Select a word or short term to define. For a passage, choose a summary.');return;}
      const term=selectedText.trim().replace(/^[\s.,;:!?“”"'()]+|[\s.,;:!?“”"'()]+$/g,'');
      const meta={title:term,source:'Wikipedia · English',kind:'definition' as const,scope:'Selected term'};
      // Dictionary first gives attributed, established definitions when available.
      if(/^[a-zA-Z-]+$/.test(term)){
        setAiStatus('Looking up the definition…');
        const controller=new AbortController();dictionaryAbort.current=controller;
        const id=++requestId.current,timer=setTimeout(()=>controller.abort(),12000);
        try{
          const response=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.toLowerCase())}`,{signal:controller.signal});
          if(response.ok){
            const results=await response.json();
            const meanings=results[0]?.meanings?.slice(0,3).map((m:any)=>`${m.partOfSpeech}. ${m.definitions[0].definition}${m.definitions[0].example?`\n“${m.definitions[0].example}”`:''}`).join('\n\n');
            if(meanings&&id===requestId.current){setInsight({...meta,text:meanings,source:'Free Dictionary API · English',url:results[0]?.sourceUrls?.[0]||`https://en.wiktionary.org/wiki/${encodeURIComponent(term.toLowerCase())}`});setAiStatus('');return;}
          }
        }catch{/* Context explanation is available if no dictionary entry exists. */}
        finally{clearTimeout(timer);}
        if(id!==requestId.current)return;
      }
      setAiStatus('Looking up the term in Wikipedia…');
      const id=++requestId.current;
      const controller=new AbortController();dictionaryAbort.current=controller;
      const timer=setTimeout(()=>controller.abort(),15000);
      try{
        const query=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:term,gsrlimit:'1',prop:'extracts|info',exintro:'1',explaintext:'1',inprop:'url',origin:'*'});
        const response=await fetch(`https://en.wikipedia.org/w/api.php?${query}`,{signal:controller.signal});
        if(!response.ok)throw new Error('No entry');
        const result=await response.json();
        const entry:any=Object.values(result.query?.pages||{})[0];
        if(entry?.extract&&id===requestId.current){setInsight({...meta,title:entry.title,text:entry.extract.split('\n').filter(Boolean).slice(0,2).join('\n\n'),url:entry.fullurl});setAiStatus('');return;}
      }catch{/* The explicit lookup link remains available. */}finally{clearTimeout(timer);}
      if(id===requestId.current){setAiStatus('');notify('No definition was available. Use “Look up this term on the web” to explore it.');}
      return;
    }
    const text=chosen==='through'?book.text.slice(0,selection.end):selectedText;
    neural('summary',text,{title:chosen==='through'?'The story so far':'Your passage, in brief',source:'Transformer summary · on your device',kind:'summary',scope:chosen==='through'?`Beginning through page ${pageIndex+1} · ${words(text).toLocaleString()} words`:`Selected passage · ${words(text).toLocaleString()} words`});
  }

  function changeRange(which:'start'|'end',number:number){
    const target=book.pages[number-1];if(!target)return;
    const next={...bounds,[which]:which==='start'?target.start:target.end};
    if(next.start>=next.end){notify('The starting point must come before the stopping point.');return;}
    setBounds(next);if(which==='start')setPageIndex(number-1);
  }
  function selectedBoundary(which:'start'|'end'){
    if(!selection)return;
    const value=which==='start'?selection.start:selection.end;
    const next={...bounds,[which]:value};
    if(next.start>=next.end){notify('The starting point must come before the stopping point.');return;}
    setBounds(next);notify(which==='start'?'Reading will begin at your selection.':'Reading will stop at the end of your selection.');
  }
  function changeLanguage(language:string){
    const voice=speech.voices.find(v=>v.lang===language)||speech.voices.find(v=>v.lang.split('-')[0]===language.split('-')[0]);
    setOptions({...options,language,voiceURI:voice?.voiceURI||''});
  }
  function changeVoice(voiceURI:string){const voice=speech.voices.find(v=>v.voiceURI===voiceURI);setOptions({...options,voiceURI,language:voice?.lang||options.language});}
  const controls=useRef<any>(null);
  controls.current={book,bounds,setBounds,setPageIndex,speech,setOptions,options};
  useEffect(()=>{
    const context=(document as any).modelContext;if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    const tools=[
      {name:'read_document_state',description:'Read the current document, page count, reading range and playback settings.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>{const c=controls.current;return{title:c.book.name,pages:c.book.pages.length,range:c.bounds,settings:c.options,status:c.speech.status};}},
      {name:'configure_reading_range',description:'Set inclusive starting and stopping pages in the loaded document. This stops playback.',inputSchema:{type:'object',properties:{startPage:{type:'integer',minimum:1},endPage:{type:'integer',minimum:1}},required:['startPage','endPage'],additionalProperties:false},annotations:{readOnlyHint:false},execute:(input:any)=>{const c=controls.current;if(!Number.isInteger(input.startPage)||!Number.isInteger(input.endPage)||input.startPage<1||input.endPage<input.startPage||input.endPage>c.book.pages.length)throw new Error('Choose a valid inclusive page range.');const range={start:c.book.pages[input.startPage-1].start,end:c.book.pages[input.endPage-1].end};c.speech.stop();c.setBounds(range);c.setPageIndex(input.startPage-1);return{range};}}
    ];
    for(const tool of tools)try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
    return()=>lifecycle.abort();
  },[]);

  return <div className="app-shell" onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);const file=e.dataTransfer.files[0];if(file)void openFile(file);}}>
    <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void openFile(file);e.target.value='';}}/>
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="Folio reading studio"><span className="brand-icon"><BookOpen size={21}/></span>folio<span className="brand-period">.</span></a>
      <div className="sidebar-heading">YOUR WORKSPACE</div>
      <div className="nav-active"><Headphones size={18}/> Reading studio <span className="nav-indicator"/></div>
      <div className="sidebar-divider"/>
      <div className="sidebar-heading">CURRENT DOCUMENT</div>
      <div className="document-cover"><BookOpen size={36} strokeWidth={1.25}/><div className="cover-lines"/><span>{book.sample?'THE ART OF\nPAYING ATTENTION':'YOUR NEXT\nDISCOVERY'}</span><small>{book.sample?'A FOLIO READING SAMPLE':'PDF DOCUMENT'}</small></div>
      <h2 className="sidebar-title">{book.name}</h2>
      <p className="document-meta">{book.pages.length} pages <span>·</span> {totalMinutes} min listen</p>
      {book.sample&&<span className="sample-badge">Sample document</span>}
      <div className="page-list-heading">IN THIS DOCUMENT</div>
      <nav className="page-list" aria-label="Document pages">{book.pages.map((p,i)=><button key={i} className={i===pageIndex?'page-link current':'page-link'} onClick={()=>{setPageIndex(i);setSelection(null);}}><span className="page-number">{String(i+1).padStart(2,'0')}</span><span>{book.sample?['A little room for discovery','Follow your curiosity','Find your own rhythm'][i]:`Page ${i+1}`}</span>{i===pageIndex&&<span className="page-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><ShieldCheck size={18}/><div>Your PDF stays on this device<small>No document upload required</small></div></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div><span className="eyebrow">READ A LITTLE. DISCOVER A LOT.</span><h1>Reading studio</h1></div><button className="button primary upload-button" onClick={()=>fileInput.current?.click()} disabled={!!loading}>{loading?<LoaderCircle className="spin" size={17}/>:<Upload size={17}/>}<span>{loading?'Opening PDF':'Open PDF'}</span></button></header>
      <div className="studio-layout">
        <main className="reading-column">
          <div className="reader-toolbar"><div className="reader-mode"><ScanText size={17}/>Text view</div><div className="page-control"><button aria-label="Previous page" disabled={pageIndex===0} onClick={()=>{setPageIndex(pageIndex-1);setSelection(null);}}><ChevronLeft size={18}/></button><span>Page <strong>{pageIndex+1}</strong> of {book.pages.length}</span><button aria-label="Next page" disabled={pageIndex===book.pages.length-1} onClick={()=>{setPageIndex(pageIndex+1);setSelection(null);}}><ChevronRight size={18}/></button></div><div className="font-control"><button aria-label="Decrease text size" disabled={fontSize<=16} onClick={()=>setFontSize(fontSize-2)}><Minus size={14}/></button><span>Aa</span><button aria-label="Increase text size" disabled={fontSize>=32} onClick={()=>setFontSize(fontSize+2)}><Plus size={14}/></button></div></div>
          <div className="reader-scroll" ref={scroll}>
            <div className="reading-paper" ref={reader} onMouseUp={captureSelection} onTouchEnd={()=>setTimeout(captureSelection,100)} onKeyUp={captureSelection}>
              <div className="paper-kicker">{book.sample?'THE ART OF PAYING ATTENTION':book.name}</div>
              <h2>{book.sample?['A little room\nfor discovery','Follow your\ncuriosity','Find your\nown rhythm'][pageIndex]:`Page ${pageIndex+1}`}</h2>
              <div className="paper-rule"/>
              <div className="page-text" data-page-start={page.start} style={{fontSize:`${fontSize}px`}}><TextSurface text={page.text} start={page.start} selected={selection} active={speech.active}/></div>
              {!page.text&&<div className="page-empty"><FileText size={25}/><p>This page has no selectable text.</p><small>A scanned page needs OCR before it can be read aloud.</small></div>}
              <div className="paper-footer"><span>{book.sample?'FOLIO READING SAMPLE':'EXTRACTED PDF TEXT'}</span><span>{String(pageIndex+1).padStart(2,'0')}</span></div>
            </div>
          </div>
          <div className={selection?'selection-bar selected':'selection-bar'}>
            {selection?<><span><Highlighter size={16}/><strong>{words(selectedText)} words</strong> selected</span><div className="selection-actions"><button onMouseDown={e=>e.preventDefault()} onClick={()=>selectedBoundary('start')}><MapPin size={14}/>Start here</button><button onMouseDown={e=>e.preventDefault()} onClick={()=>selectedBoundary('end')}><Flag size={14}/>Stop here</button><button onMouseDown={e=>e.preventDefault()} aria-label="Clear selection" onClick={()=>{setSelection(null);window.getSelection()?.removeAllRanges();}}><X size={15}/></button></div></>:<><Highlighter size={16}/><span>Highlight a word or passage to explore it.</span></>}
          </div>
          <section className="player" aria-label="Audio player"><div className="player-top"><div className="player-book-icon"><Headphones size={22}/></div><div className="player-title"><strong>{book.name}</strong><span>{speech.status==='playing'?'Reading aloud':speech.status==='paused'?'Paused':'Ready when you are'} <span>·</span> Pages {startPage}–{endPage}</span></div><span className="speed-pill">{options.rate.toFixed(2).replace(/0$/,'')}×</span></div><div className="player-bottom"><div className="transport"><button className="restart" aria-label="Restart reading range" onClick={()=>speech.startAt(bounds.start)}><RotateCcw size={18}/></button><button className="play-button" aria-label={speech.status==='playing'?'Pause reading':'Play reading'} onClick={speech.toggle}>{speech.status==='playing'?<Pause size={21} fill="currentColor"/>:<Play size={21} fill="currentColor"/>}</button><button className="stop-button" aria-label="Stop reading" onClick={speech.stop}><Square size={16}/></button></div><div className="playback-progress"><input aria-label="Reading position" type="range" min={bounds.start} max={bounds.end} step="1" value={Math.max(bounds.start,Math.min(speech.position,bounds.end))} style={{'--fill':`${progress}%`} as any} onChange={e=>{const n=Number(e.target.value);speech.seek(n);onPosition(n);}}/><div className="time-labels"><span>{Math.floor(progress/100*boundedMinutes)} min</span><span>~{boundedMinutes} min <span>·</span> {Math.round(progress)}%</span></div></div><button className="mute-button" aria-label={options.volume?'Mute volume':'Unmute volume'} onClick={()=>setOptions({...options,volume:options.volume?0:.8})}>{options.volume?<Volume2 size={20}/>:<VolumeX size={20}/>}</button></div></section>
          <p className="reader-note">Make space for the words. Listen at your own pace.</p>
        </main>

        <aside className="tools-column">
          <section className="tool-card listening-card"><div className="card-heading"><Settings2 size={17}/><h2>Listening settings</h2></div><label className="control-label" htmlFor="language">Language</label><select id="language" value={options.language} onChange={e=>changeLanguage(e.target.value)}>{languageOptions.map(lang=><option key={lang} value={lang}>{languageLabels[lang]||lang}</option>)}</select><label className="control-label" htmlFor="voice">Voice</label><select id="voice" value={options.voiceURI} onChange={e=>changeVoice(e.target.value)}><option value="">System default</option>{matchingVoices.map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.localService?' · device':''}</option>)}</select><p className="field-note">{matchingVoices.length?'Voices available on your device.':'Available voices depend on your browser and device.'} Language selects pronunciation.</p><div className="slider-label"><label htmlFor="speed">Reading speed</label><strong>{options.rate.toFixed(2).replace(/0$/,'')}×</strong></div><input id="speed" type="range" min="0.5" max="2" step="0.05" value={options.rate} onChange={e=>setOptions({...options,rate:Number(e.target.value)})} style={{'--fill':`${(options.rate-.5)/1.5*100}%`} as any}/><div className="slider-ticks"><span>0.5×</span><span>1×</span><span>2×</span></div><div className="slider-label volume-label"><label htmlFor="volume"><Volume2 size={15}/>Volume</label><strong>{Math.round(options.volume*100)}%</strong></div><input id="volume" type="range" min="0" max="1" step="0.01" value={options.volume} onChange={e=>setOptions({...options,volume:Number(e.target.value)})} style={{'--fill':`${options.volume*100}%`} as any}/><label className="autoplay-control"><input type="checkbox" checked={autoPlay} onChange={e=>setAutoPlay(e.target.checked)}/>Listen after opening a PDF</label></section>
          <section className="tool-card range-card"><div className="card-heading"><BookMarked size={17}/><h2>Your reading range</h2><button aria-label="Reset reading range to whole document" onClick={()=>setBounds({start:0,end:book.text.length})}><RotateCcw size={14}/></button></div><div className="range-controls"><div><label htmlFor="start-page">Begin at</label><select id="start-page" value={startPage} onChange={e=>changeRange('start',Number(e.target.value))}>{book.pages.map(p=><option key={p.number} value={p.number}>Page {p.number}</option>)}</select></div><span className="range-line"/><div><label htmlFor="end-page">Stop after</label><select id="end-page" value={endPage} onChange={e=>changeRange('end',Number(e.target.value))}>{book.pages.map(p=><option key={p.number} value={p.number}>Page {p.number}</option>)}</select></div></div><p className="field-note">{bounds.start!==book.pages[startPage-1]?.start||bounds.end!==book.pages[endPage-1]?.end?'Your range uses the exact highlighted text position.':'Or highlight text to set an exact start or stop.'}</p></section>
          <section className="tool-card insight-card"><div className="card-heading"><Sparkles size={18}/><h2>A little more understanding</h2></div><div className="tool-tabs" role="tablist" aria-label="Text tools"><button role="tab" aria-selected={tool==='selection'} className={tool==='selection'?'active':''} onClick={()=>setTool('selection')}>Summarize</button><button role="tab" aria-selected={tool==='define'} className={tool==='define'?'active':''} onClick={()=>setTool('define')}>Define</button><button role="tab" aria-selected={tool==='through'} className={tool==='through'?'active':''} onClick={()=>setTool('through')}>Up to here</button></div>
            {selection?<div className="selection-preview"><span>YOUR SELECTION</span><blockquote>“{selectedText.trim().slice(0,160)}{selectedText.trim().length>160?'…':''}”</blockquote></div>:<div className="insight-empty"><span className="insight-symbol"><Highlighter size={23} strokeWidth={1.5}/></span><p>A good question starts<br/>with a little highlight.</p><small>{tool==='define'?'Select a word or term to find its meaning.':tool==='through'?'Select where to end your summary.':'Select a passage to find its main ideas.'}</small></div>}
            <button className="button ai-button" disabled={!selection||!!aiStatus} onClick={()=>void runTool()}>{aiStatus?<LoaderCircle size={16} className="spin"/>:<Sparkles size={16}/>}<span>{aiStatus?'Working…':tool==='define'?'Define selection':tool==='through'?'Summarize up to here':'Summarize selection'}</span></button>
            {aiStatus&&<div className="ai-progress" role="status"><p>{aiStatus}</p><button onClick={cancelAI}>Cancel</button></div>}
            {selection&&tool==='define'&&<a className="lookup-link" href={`https://www.google.com/search?q=${encodeURIComponent(selectedText.trim())}`} target="_blank" rel="noopener noreferrer"><Search size={14}/>Look up this term on the web</a>}
            {insight&&<div className="insight-result" aria-live="polite"><div className="result-heading"><span>{insight.kind==='summary'?'SUMMARY':'DEFINITION'}</span><button aria-label="Dismiss result" onClick={()=>setInsight(null)}><X size={14}/></button></div><h3>{insight.title}</h3><span className="result-scope">{insight.scope}</span><p>{insight.text}</p><small>{insight.url?<a href={insight.url} target="_blank" rel="noopener noreferrer">{insight.source}</a>:insight.source}</small>{insight.kind==='summary'||insight.source.startsWith('Neural')?<small className="accuracy-note">AI can miss details. Check the original passage.</small>:null}</div>}
            <div className="neural-note"><ShieldCheck size={13}/><span>{aiReady?'Neural model ready on this device':'Neural summaries run on your device'}</span></div><p className="model-note">First use downloads a neural model (~25 MB). Summaries select key sentences and work best with English text.</p>
          </section>
        </aside>
      </div>
    </div>
    {notice&&<div className="toast" role="status"><Check size={17}/><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {(dragging||loading)&&<div className="drop-overlay"><div>{loading?<LoaderCircle className="spin" size={35}/>:<Upload size={35}/>}<h2>{loading||'Drop your PDF here'}</h2><p>{loading?'Making room for your next read.':'A new book. A new perspective.'}</p>{loading&&<button className="button secondary" onClick={()=>{upload.current?.abort();setLoading('');}}>Cancel</button>}</div></div>}
  </div>;
}
