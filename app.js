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

  const supabase = getSupabaseClientWithToken(token);

  const { user, error } = await supabase.auth.getUser();
  if (error || !user) return res.status(401).json({ error: 'Token inválido' });
  const { data, error1 } = await supabase
  .rpc('ultima_mensagem_por_chat', { user_uuid: user.id });

  if (error1) {
    console.error('❌ Erro ao buscar mensagens:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
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


// SOCKET 

io.on('connection', (socket) => {
  console.log('🟢 Novo socket conectado:', socket.id);
  
  socket.on('usuario_online', async({ userId }) => {
    socket.userId = userId
    console.log(`✅ Usuário ${userId} online com socket ${socket.id}`);
    const agora = new Date().toISOString();
    const { data, error } = await supabase.from("Users").update({socket_id: socket.id, socket_updated_at: agora}).eq("id",userId).select()

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
});

server.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});