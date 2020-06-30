const express = require('express');
const bodyParser = require('body-parser')
const axios = require("axios");
const fs = require("fs");
const app = express();
const token = process.env.BOTKEY;
const botURL = `https://api.telegram.org/bot${token}/`

const PORT = process.env.PORT || 5000;

const axiosInstance = axios.create({
  baseURL:botURL
});


let queriesQueue = {}
let registeredQueriesHandlers = {}
let botCommands = {};
const handlers = {
  "add_cmd":add_cmd,
  "add_new_cmd":add_new_cmd,
  "add_auth":add_auth,
  "say":say,
  "query_handler":query_handler
}

function getCmd(cmd,cmdArr){
  let command = cmdArr.shift();
   if(!command){
     return cmd;
   }
 if(cmd === null){
    cmd = botCommands[command]; 
     return getCmd(cmd,cmdArr);
 }
     cmd = cmd.commands[command];
     return getCmd(cmd,cmdArr);
}


function query_handler(senderId,data,chatId,callback){
  let cmdArr = data.split(" ");
  let cmd = getCmd(null,cmdArr);
  //if(!chatId) return callback();
  if(cmd){
    registeredQueriesHandlers[senderId] = {cmd};
    sendMessage(chatId,cmd.queryMsg).then(()=>{
      callback();
    })
    .catch(()=>{
//      callback();
    });
  }
}

function sendRejectCmdParams(chatId,params){
  sendMessage(chatId,`Invalid params, ${params}`)

}

function add_new_cmd(data,self){
  return new Promise((resolve,reject)=>{
    const {message} = data;
    const {text} = message;
    if(!text || text.split(" ").length < 2) {
      sendRejectCmdParams(message.chat.id,self.queryMsg);
      return reject();
    }
    const rawtext = text.replace(/  +/g,' '); //format one simple space to prevent errors
    let newCmd = rawtext.split(" ",1)[0];
    let params = rawtext.substring(newCmd.length,rawtext.length).trim();
    newCmd = newCmd.replace("/","");
    resolve(saveCmd(newCmd,params,message));
  });
 }

 function say(data,_,self){
    if(self.params)
    sendMessage(data.message.chat.id,self.params);
 }

 function saveCmd(cmdName,data,message){
   return new Promise((resolve,reject)=>{
    let cmd = botCommands[cmdName];
    if(cmd){
      if(cmd.isEditable){
        cmd.params = data;
        resolve(sendMessage(message.chat.id,`Command ${cmdName} edited!`));
      }else{
        reject(sendMessage(message.chat.id,`Cannot edit a non editable command`));
      }
    }else{
      botCommands[cmdName] = {
        isPublic:true,
        isEditable:true,
        handler:"say",
        description:"message",
        params:data,
      };
      fs.writeFileSync("cmds.json",JSON.stringify(botCommands));
      let keys = Object.keys(botCommands);
      let commands = [];
      for(let k of keys){
        let command = botCommands[k];
        const {description} = command;
        commands.push({"command":k,description});
      }
      axiosInstance.post('setMyCommands',{commands}).then(()=>{
        resolve(sendMessage(message.chat.id,`Command ${cmdName} added!`));
      }).catch(()=>{
        resolve(sendMessage(message.chat.id,`Error registering command ${cmdName}`));   
      });
    }
   })
 }

function add_auth(data){
  return new Promise((resolve,reject)=>{

  });
}

botCommands = {
  add:{
    isPublic:false,
    isEditable:false,
    handler:"add_cmd",
    params:null,
    queryMsg:"Choose what you want to add",
    description:"Add new cmd or authorization",
    queryHandler:"query_handler",
    commands:{
      cmd:{
        handler:"add_new_cmd",
        queryMsg:"Insert <command_name> <text>"
      },
      auth:{
        handler:"add_auth",
        queryMsg:"Insert <userName>"
      }
    }
  }
}
if(!fs.existsSync("cmds.json")){
  fs.writeFileSync("cmds.json",JSON.stringify(botCommands));
}else{
  console.log("loading saved commands from file");
  botCommands = JSON.parse(fs.readFileSync("cmds.json"));
}

const addKeyBoard =  {
  "inline_keyboard":[
    [{
    "text":"COMMAND",
    "callback_data":"add cmd"
  }],
   [{   "text":"AUTH",
    "callback_data":"add auth"
  }]
]
};


function add_cmd(data,params,self){
  const {message} = data;
  if(!message) return;
  const {chat} = message;
  if(!chat) return;
  const {id} = chat;
  sendMessage(id,self.queryMsg,{reply_markup:addKeyBoard})
  .then((res)=>addToQuerieQueu(message,res.data,self))
  .catch(()=>{});
}

function addToQuerieQueu(message,data,self){
  if(data.ok){
    const {result} = data;
    const {message_id} = result;
    const senderId = message.from.id;
    queriesQueue[message_id] = {senderId,cmd:self};
  }
}

function callbackQueryParser(data){
  answerCallbackQuery(data);
}

function answerCallbackQuery(data){
  const {callback_query} = data;
  if(callback_query,data){
    const {id,message,from,data} = callback_query;
    if(id && message){
      const {message_id,chat} = message;
      if(!queriesQueue[message_id])  return axiosInstance.post("answerCallbackQuery",{callback_query_id:id});
      const {senderId,cmd} = queriesQueue[message_id]
      if(from.id === senderId){
        delete queriesQueue[message_id];
		console.log(cmd);
        handlers[cmd.queryHandler](senderId,data,chat.id,()=>{
          return axiosInstance.post("answerCallbackQuery",{callback_query_id:id});
        });
        return
      }
      return axiosInstance.post("answerCallbackQuery",{callback_query_id:id});
    }
  }
}

const specialParsers = {
  "callback_query":callbackQueryParser
}

axiosInstance.defaults.headers.post['Content-Type'] = 'application/json';
app.use(bodyParser.json());

app.get('/', function (req, res) {
  res.send('Hello World!');
});

app.post('/update',function(req,res){
  parseRaw(req.body);
	return res.sendStatus(200);
});

app.listen(PORT, function () {
  console.log('Example app listening on port '+PORT);
});

function parseRaw(data){
  const {message} = data;
  if(message){
    if(Object.keys(registeredQueriesHandlers).length > 0){
      let senderId = message.from.id;
      if(senderId){
        let {cmd} = registeredQueriesHandlers[senderId];
        if(cmd){
            handlers[cmd.handler](data,cmd).then(()=>{
              delete registeredQueriesHandlers[senderId];
            }).catch(()=>{});
            return;
        }
      }
    }
    if(message.entities){
    let entity = message.entities.filter(e => e.type === "bot_command");
    if(entity && entity.length > 0){
      parseBotCmd(data);
      return;
    }
  }
  }else{
      parseSpecial(data);
  }
}

function parseBotCmd(data){
  const {message} = data;
  const {text} = message;
  if(text && text.startsWith("/")){
    const rawtext = text.replace(/  +/g,' '); //format one simple space to prevent errors
    let cmd = rawtext.split(" ",1)[0];
    let params = text.substring(cmd.length,rawtext.length).trim();
    cmd = cmd.replace("/","");
    parseCmd(cmd,{data,params});
  }
}

function parseCmd(cmd,payload){
  let {data,params} = payload;
  let command = botCommands[cmd];
  if(command){
    handlers[command.handler](data,params,command);
  }
}

function parseSpecial(data){
    let keys = Object.keys(data);
    for(let key of keys){
      let parser = specialParsers[key]
      if(parser){
        parser(data);
        return;
      } 
    }
}

function sendMessage(chatId,message,opt={}){
    data = {
        "chat_id": chatId,
        "text": message,
        ...opt
    }
  return axiosInstance.post("sendMessage",data);
}

