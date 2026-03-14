# Mini-Evolution Pro 🚀

API de Integração WhatsApp de Alta Performance.

## 🏗️ Nova Arquitetura

O sistema foi completamente refatorado utilizando **TypeScript** e padrões modernos de engenharia de software:

- **Provedores Isolados**: Cada instância roda em sua própria classe configurada.
- **Filas de Processamento**: Webhooks gerenciados via **BullMQ/Redis** com retentativas automáticas.
- **Gerenciamento de Mídia**: Download automático de fotos, vídeos e áudios para persistência local.
- **Segurança**: Autenticação via API Key global ou por instância.
- **Escalabilidade**: Preparado para rodar em **Docker** com suporte a PostgreSQL.

## 🚀 Como Iniciar

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Configure o seu arquivo `.env` (use o `.env.example` como base).

3. Inicie em modo de desenvolvimento:
   ```bash
   npm run dev
   ```

## 📡 Endpoints Principais

### Instâncias
- `POST /instance/create`: Cria nova instância.
- `POST /instance/connect/:instance`: Inicia/Busca QR Code.
- `GET /instance/status/:instance`: Verifica estado da conexão.
- `POST /instance/restart/:instance`: Reinicia o serviço.

### Mensagens
- `POST /message/sendText/:instance`: Envia texto.
- `POST /message/sendImage/:instance`: Envia imagem (URL ou Base64).
- `POST /message/sendAudio/:instance`: Envia áudio PTT.
- `POST /message/sendVideo/:instance`: Envia vídeo.
- `POST /message/sendReaction/:instance`: Envia reação com emoji.

## 🐳 Docker

Para rodar o ambiente completo:
```bash
docker-compose up -d
```
