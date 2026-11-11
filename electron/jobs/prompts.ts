import { EventEmitter } from 'events';
import crypto from 'crypto';
import type { BatchPrompt, PromptChoice, ActionResult,RecoverySummary } from '../../common/types/batch-ui';
export function startupRecoverable(session:RecoverySummary){
  if(['completed','completed-with-errors','cancelled'].includes(session.phase)||session.shutdown==='clean')return false;
  return session.shutdown==='open'||['running','pausing','resuming','recovering','preparing','failed'].includes(session.phase);
}

// Main-process authority: renderer tokens are single-use, action execution is
// serialized, and a failed action keeps the prompt open with its data intact.
export class BatchPrompts extends EventEmitter {
  current:BatchPrompt|null=null;
  private execute?: (choice:PromptChoice)=>Promise<void>;
  private finish?: (choice:PromptChoice|null)=>void;
  open(data:Omit<BatchPrompt,'token'|'busy'>,execute:(choice:PromptChoice)=>Promise<void>):Promise<PromptChoice|null> {
    if(this.current)return Promise.resolve(null);
    this.execute=execute;
    const result=new Promise<PromptChoice|null>(resolve=>{this.finish=resolve;});
    this.current={...data,token:crypto.randomUUID(),busy:false};this.emit('change',this.current);
    return result;
  }
  async act(token:string,choice:PromptChoice):Promise<ActionResult> {
    const p=this.current;
    if(!p||p.token!==token||p.busy)return {ok:false,error:'This action is no longer available.'};
    const allowed=p.kind==='startup'?['resume','dismiss']:p.kind==='folder'?['resume','fresh','dismiss']:['stop','dismiss'];
    if(!allowed.includes(choice))return {ok:false,error:'Invalid action for this dialog.'};
    p.busy=true;p.error=undefined;this.emit('change',{...p});
    try {
      await this.execute!(choice);
      const finish=this.finish;this.current=null;this.execute=undefined;this.finish=undefined;
      this.emit('change',null);finish?.(choice);return {ok:true};
    }catch(error){
      p.busy=false;p.error=String(error).replace(/^Error:\s*/,'').slice(0,400);this.emit('change',{...p});
      return {ok:false,error:p.error};
    }
  }
}
