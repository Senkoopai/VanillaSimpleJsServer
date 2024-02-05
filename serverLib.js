const http = require('http')
const fs = require('fs')
const ngrok = require('ngrok')
const { error } = require('console')
const ws = require('ws')
const { parse } = require('path')
const { types } = require('util')
const strUtils = require('./strUtils')


class MsgType{
  size;
  conv;
  read;
  constructor(size,conv,read){
    this.size = size
    this.conv = conv
    this.read = read
  }
}



class Msg{
  body
  connectionId
  clientHandler
  httpHeaders
  constructor(body,httpHeaders,connectionId,clientHandler,end){
    this.body = body
    this.connectionId = connectionId
    this.clientHandler = clientHandler
    this.httpHeaders = httpHeaders
    this.end = (body,err,statusCode) =>{
      this.body = body
      this.err = err
      this.statusCode = statusCode
      end(this)
    }
  }
  err
  statusCode

  static type = {
  uInt64:{size:(buff)=>{return 8},conv:(num)=>{
    var buff = Buffer.allocUnsafe(8)
    buff.writeBigUInt64BE(BigInt(num),0)
    return buff
  },read:(buff)=>{
    return (new Number(buff.readBigUInt64BE(0)))+0
  }},

  uInt16:{size:(buff)=>{return 2},conv:(num)=>{
    var buff = Buffer.allocUnsafe(2)
    buff.writeInt16BE(num,0)
    return buff
  },read:(buff)=>{
    return (new Number(buff.readUInt16BE(0)))+0
  }}
  }

  static types = [
    Msg.type.uInt64,
    Msg.type.uInt16,
    new MsgType((buff)=>{return Msg.type.uInt64.read(buff.subarray(0,8))+8;},(str)=>{return Buffer.concat([Msg.type.uInt64.conv(str.length),Buffer.alloc(str.length,str)])},(buff)=>{ return `${buff.subarray(8)}`}),
    new MsgType((buff)=>{return Msg.type.uInt64.read(buff.subarray(0,8))+8;},(str)=>{return Buffer.concat([Msg.type.uInt64.conv(str.length),str])},(buff)=>{ return buff.subarray(8)})
    
  ]

  static encode(vals){
    var body = []
    //if (repeats != 1){
      //body.push(Msg.type[Msg.enums.type.uInt64].conv(repeats))
   // }
   var typeId = 0
   for (var i = 0; i < vals.length; i++){
    if (typeof vals[i] === 'string'){
      typeId = 2
      
    }else if (typeof vals[i] === 'number'){
      typeId = 4
    }else if (vals[i] instanceof Buffer){
      typeId = 3
    }
    body.push(Buffer.alloc(1,typeId))
    body.push(this.types[typeId].conv(vals[i]))
   }
   
    return Buffer.concat(body)
  }

  static decode(buff){
    var b = 0
    var size = 0
    var vals = []
    //console.log(buff)
    while (b < buff.length){

      var type = this.types[buff.subarray(b,b+1)[0]]
      if (type == undefined){
        //console.log('hello')
        return vals
      }
      b+=1
      size = type.size(buff.subarray(b))
      b+=size
     
      vals.push(type.read(buff.subarray(b-size,b)))
      
    }
    return vals
  }
}



class Server{
  web
  channel
  filesPath
  faviconIcon
  connectionIds = new Map()
  connections = new Map()
  handlers = new Map()

  //handlerId = 0
  

  setHandler(name,fx){
    //console.log(name.hashCode())
    this.handlers.set(name.hashCode(),fx)
  }

  
  

  send(body,connectionId,clientHandler){
    this.connections.get(connectionId).send(Buffer.concat([Buffer.alloc(1,0),Msg.type.uInt64.conv(clientHandler.hashCode())].concat(Msg.encode(body))))
  }

  


  clientJsFile;
  constructor(filesPath,port=80,hostname='localhost'){
    this.filesPath = filesPath
    this.clientJsFile = fs.readFileSync(this.filesPath+'/client.js')
    this.handlers.set(742169049,(msg)=>{
      msg.end('Server handler or webpage not found','1',404)
    })
    this.web = http.createServer((req,res)=>{
      //console.log(res)
      if (req.url == '/favicon.ico'){
        res.writeHead(200)
        res.end(this.faviconIcon)
        return
      }
      if (req.url == '/client.js'){
        res.writeHead(200)
        res.end(this.clientJsFile)
        return
      }
      var urlData = req.url.slice(1).split('/')
      var body = []
      if (urlData.length == 2){
        body.push(decodeURI(urlData[1]))
      }
      //console.log(urlData)
      //var handlerId = this.handlerIds.get(urlData[0])
      var handler = this.handlers.get(urlData[0].hashCode())

      if (handler == undefined){
        this.handlers.get(742169049)(new Msg(body,req.headers,null,null,(resMsg)=>{
          console.log(resMsg)
          res.writeHead(resMsg.statusCode)
          res.end(resMsg.body)
        }))
        return
      }      

      if (req.method == 'GET'){
        handler(new Msg(body,req.headers,null,null,(resMsg)=>{
          res.writeHead(resMsg.statusCode)
          res.end(resMsg.body[0])
        }))
        return
      }
      var data = []
      req.on('data',(chunk)=>{
        data.push(chunk)
      })
      req.on('end',()=>{
        body.push(data)
        handler(new Msg(data,req.headers,null,null,(resMsg)=>{
          res.writeHead(resMsg.statusCode)
          res.end(resMsg.body)
        }))
      })
    }).listen(port,hostname);


   


    this.channel = new ws.WebSocketServer({server:this.web})
    
    this.channel.on('connection',(connection,req)=>{

      //console.log('hsfdfdsf')
      connection.on('close',()=>{
        console.log('User Disconnected')
        this.connections.delete(this.connectionIds.get(connection))
        this.connectionIds.delete(connection)
      })
      //console.log(req)
      //console.log(req,'dingDONFAS')
        
      //console.log('dingDOng')
      connection.on('message',data=>{

        var id = this.connectionIds.get(connection)
        

        //console.log('ds')
        //console.log(data.length)
        if (data.length < 11){
          return
        }

        var serverHandler = Msg.type.uInt64.read(data.subarray(0,8))
        var clientHandler = Msg.type.uInt16.read(data.subarray(8,10))
        //var body = data.subarray(10)

        //console.log(`${body[1]}`)
        //console.log()

        if (id == undefined){
          this.connections.set(0,connection)
          this.connectionIds.set(connection,0)
          console.log('User Connected')
          this.send(['HI','Success'],0,'')
          return
        }




        var handler = this.handlers.get(serverHandler)


        if (handler == undefined){
          return
        }
       //console.log('HIHIIHIIHDISA')
        //console.log(serverHandler,'dsfdsf')
        //console.log(Msg.decode(data.subarray(10)))
        handler(new Msg(Msg.decode(data.subarray(10)),null,id,clientHandler-1,(resMsg)=>{
          if (resMsg.clientHandler == -1){
            return
          }
          console.log(resMsg)
          this.connections.get(resMsg.connectionId).send(Buffer.concat([Buffer.alloc(1,1),Msg.type.uInt16.conv(resMsg.clientHandler)].concat(Msg.encode(resMsg.body))))

        }))


      })
    })
  }



}


module.exports = {
  Msg,
  Server
}
