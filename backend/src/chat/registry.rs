use std::{collections::HashMap,sync::Arc};
use tokio::sync::{RwLock,broadcast};
use uuid::Uuid;

#[derive(Default)]
struct Entry{sender:Option<broadcast::Sender<String>>,count:usize}
#[derive(Clone,Default)]
pub struct WsRegistry{channels:Arc<RwLock<HashMap<Uuid,Entry>>>}
impl WsRegistry{
 pub async fn subscribe(&self,id:Uuid)->(broadcast::Receiver<String>,bool){
  let mut map=self.channels.write().await;let entry=map.entry(id).or_default();
  let first=entry.count==0;let tx=entry.sender.get_or_insert_with(||broadcast::channel(256).0);
  entry.count+=1;(tx.subscribe(),first)
 }
 pub async fn unsubscribe(&self,id:Uuid)->bool{
  let mut map=self.channels.write().await;let Some(entry)=map.get_mut(&id)else{return false;};
  entry.count=entry.count.saturating_sub(1);if entry.count==0{map.remove(&id);true}else{false}
 }
 pub async fn publish(&self,id:Uuid,payload:String){
  let map=self.channels.read().await;if let Some(entry)=map.get(&id)&&let Some(tx)=&entry.sender{let _=tx.send(payload);}
 }
}
