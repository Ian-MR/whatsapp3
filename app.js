const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const http = require('http');
const cors = require('cors')
require('dotenv').config();

const { Server } = require('socket.io')
const supabase = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

function getSupabaseClientWithToken(accessToken) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

const server = http.createServer(app)
const io = new Server(server,{
  cors: {
    origin: "*",
    methods: ['GET', "POST"]
  }
})

app.get("/", (req, res) =>{
  res.send("Usuário Verificado!");

})

app.post("/signup", async (req,res) => {
  const { email, password, username } = req.body;

  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });

  if(error) return res.status(400).json({ error: error.message});

  const user = data.user;

  await supabase.from("Users").insert([{
    id: user.id,
    username: username
  }])

  res.status(201).json({message: "Usuário criado! Verifique o email"});

});

app.post("/signin", async (req,res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if(error) return res.status(401).json({ error: error.message});
  
  res.status(200).json({
    message: "Login realizado!",
    user: data.user,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token
  });

});

app.get("/history", async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token ausente' });
    
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token inválido' });
  const { data: chat, error1 } = await supabase
  .rpc('ultima_mensagem_por_chat', { user_uuid: user.user.id });

  if (error1) {
    console.error('❌ Erro ao buscar mensagens:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json(chat);
});

app.get("/chat", async (req, res) => {
  const chatId = req.query.id
  const { data, error } = await supabase
  .rpc('mensagens_do_chat', { chat_id_input: chatId });

  if (error) {
    console.error('Erro ao buscar mensagens:', error.message);
  } else {
    console.log('Mensagens do chat:', data);
  }

  res.send(data)
});

app.post("/:chatId/send", async (req, res) => {
  const { chatId } = req.params;

  const { conteudo, remetente_username } = req.body

  const { data:remetente, error } = await supabase.from("Users").select().eq("username", remetente_username)
  if(error){
    console.log("Erro ao encontrar usuário")
  }
  console.log(remetente[0].id)
  const { data:message, error1 } = await supabase.from("Messages").insert({
    remetente: remetente[0].id,
    conteudo: conteudo,
    status: "salva",
    chat_id: chatId
  }).select()
  console.log(message)
  if(error1) {
    res.status(401).send({message: "Erro ao salvar mensagem!"})
  }
  if (message) {
    const { data: participantes, error: error2 } = await supabase
      .from("ChatUsers")
      .select("user_id")
      .eq("chat_id", chatId)
      .neq("user_id", remetente[0].id);
  
    const userIds = participantes.map(p => p.user_id);
  
    const { data: sockets, error: error3 } = await supabase
      .from("Users")
      .select("socket_id")
      .in("id", userIds);
  
    sockets.forEach(user => {
      if (user.socket_id) {
        io.to(user.socket_id).emit("nova_mensagem", {
          chat_id: chatId,
          conteudo: conteudo,
          remetente: remetente_username
        });
      }
    });
  }
  res.status(200).send({message: "mensagem enviada"})
});

app.get("/new-messages", async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token ausente' });
    
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token inválido' });

  const { data: messages, error1 } = await supabase.rpc('get_mensagens_nao_lidas', { uid: user.user.id });

  if (error1){
    res.status(401).send({message: error1.message})
  }else {
    console.log(messages)
    res.status(200).send(messages)
  }
});

app.post('/iniciar-chat-com', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token ausente' });
    
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Token inválido' });

  const {  outro_usuario_username } = req.body;

  if (!outro_usuario_username) {
    return res.status(400).json({ error: 'Ambos os usuários são obrigatórios' });
  }
  const { data: other_user, errorUser } = await supabase.from("Users").eq("username", outro_usuario_username).select().single()

  if (errorUser || !other_user) {
    return res.status(404).json({ error: "Usuário não encontrado" });
  }

  // 1. Verifica se já existe um chat com exatamente os dois usuários
  const { data: chatsExistentes, error: erroBusca } = await supabase
    .rpc('buscar_chat_entre_dois_usuarios', {
      uid1: user.user.id,
      uid2: other_user.user.id
    });

  if (erroBusca) {
    return res.status(500).json({ error: erroBusca.message });
  }

  if (chatsExistentes.length > 0) {
    // já existe
    return res.json({ chat_id: chatsExistentes[0].chat_id });
  }

  // 2. Cria novo chat
  const { data: novoChat, error: erroChat } = await supabase
    .from("Chats")
    .insert({})
    .select()
    .single();

  if (erroChat) {
    return res.status(500).json({ error: erroChat.message });
  }

  // 3. Insere os dois usuários
  const { error: erroUsuarios } = await supabase
    .from("ChatUsers")
    .insert([
      { chat_id: novoChat.id, user_id: user.user.id },
      { chat_id: novoChat.id, user_id: other_user.user.id }
    ]);

  if (erroUsuarios) {
    return res.status(500).json({ error: erroUsuarios.message });
  }

  res.json({ chat_id: novoChat.id });
});

app.post("/criar-grupo", async (req, res) => {
  const { iniciador_id, membros_ids, nome } = req.body;

  const participantes = [...new Set([iniciador_id, ...membros_ids])];

  if (participantes.length < 3) {
    return res.status(400).json({ error: "Grupos precisam de ao menos 3 membros" });
  }

  const { data: chat, error } = await supabase
    .from("Chats")
    .insert({ nome, is_group: true }) // se tiver essa coluna
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const registros = participantes.map(user_id => ({ chat_id: chat.id, user_id }));

  const { error: erroUsuarios } = await supabase.from("ChatUsers").insert(registros);

  if (erroUsuarios) return res.status(500).json({ error: erroUsuarios.message });

  res.json({ chat_id: chat.id });
});

// SOCKET 

io.on('connection', (socket) => {
  console.log('🟢 Novo socket conectado:', socket.id);
  
  socket.on('usuario_online', async({ userId }) => {
    socket.userId = userId
    console.log(`✅ Usuário ${userId} online com socket ${socket.id}`);
    const agora = new Date().toISOString();
    const { data, error } = await supabase.from("Users").update({socket_id: socket.id, socket_updated_at: agora}).eq("id",userId).select("*")

    if (error) {
      console.error('❌ Erro ao atualizar socket_id no Supabase:', error.message);
    } else {
      console.log('✅ Atualizado com sucesso:', data);
    }
  });

  socket.on('disconnect', async() => {
    console.log('🔴 Socket desconectado:', socket.id);
    const agora = new Date().toISOString();
    const { data, error } = await supabase.from("Users").update({socket_id: null, socket_updated_at: agora}).eq("id",socket.userId).select()

    if (error) {
      console.error('❌ Erro ao atualizar socket_id no Supabase:', error.message);
    } else {
      console.log('✅ Atualizado com sucesso:', data);
    }
  });

  //socket.emit("mensagens_recebidas", {
  //  chat_id: "abc123",
  //  user_id: "usuario-logado-id"
  //});

  socket.on("mensagem_recebida", async ({ message_id, user_id }) => {
    await supabase
    .from("UnreadMessages")
    .update({ entregue: true })
    .eq("message_id", message_id)
    .eq("user_id", user_id);

    // Verifica se todos já receberam
    const { data: pendentes } = await supabase
      .from("UnreadMessages")
      .select("entregue")
      .eq("message_id", message_id);

    const todosReceberam = pendentes.every(p => p.entregue === true);

    if (todosReceberam) {
      await supabase
        .from("Messages")
        .update({ status: "entregue" })
        .eq("id", message_id);
    }
  });

  socket.on("mensagem_lida", async ({ message_id, user_id }) => {
    // 1. Remove a linha de não lida
    await supabase
      .from("UnreadMessages")
      .delete()
      .eq("message_id", message_id)
      .eq("user_id", user_id);
  
    // 2. Verifica se todos já leram (ou seja, ninguém mais tem essa mensagem pendente)
    const { data: pendentes } = await supabase
      .from("UnreadMessages")
      .select("id")
      .eq("message_id", message_id);
  
    if (!pendentes || pendentes.length === 0) {
      // 3. Atualiza status da mensagem como lida
      await supabase
        .from("Messages")
        .update({ status: "lida" })
        .eq("id", message_id);
  
      console.log(`✅ Mensagem ${message_id} foi lida por todos`);
    }
  });

});

server.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});