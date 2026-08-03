# LiteLLM Proxy Setup on Windows

This guide is for setting up LiteLLM in Docker on Windows and connecting it to the backend through the LiteLLM UI.

## 1. Prerequisites

- Windows machine with Docker Desktop installed and running
- A Google Gemini API key from Google AI Studio
- Access to the backend environment file at [src/ai-insights-backend/.env](src/ai-insights-backend/.env) or [.env.example](src/ai-insights-backend/.env.example)

## 2. Start LiteLLM in Docker

Open PowerShell and run:

```powershell
docker ps
```

If LiteLLM is already running, you should see the container in the list. If not, start it with the correct Docker command for your setup.

Once it is running, confirm the exposed port is reachable:

```powershell
http://localhost:17002
```

If your Docker setup uses a different host port, use that instead of `17002`.

## 3. Open the LiteLLM UI

In your browser, open:

```text
http://localhost:17002/ui
```

If the UI does not open, check:
- Docker container status
- the published port
- the LiteLLM container logs

You can check logs with:

```powershell
docker logs <litellm_container_name>
```

## 4. Create the LiteLLM credentials

In the LiteLLM UI, create or confirm the following:

### Master key
- Use this for admin access to the LiteLLM proxy
- Keep it private
- Store it in your environment as:

```env
LITELLM_MASTER_KEY=your_master_key_here
```

### New credential
1. Open the LiteLLM UI.
2. Go to the credentials or keys section.
3. Click to create a new credential.
4. Give it a name such as `gemini-credential`.
5. Save the credential.

This credential will be used when creating the model entry.

## 5. Add the Gemini model with the created credential

In the LiteLLM UI, add or configure a model entry for Gemini.

### Steps
1. Go to the Models section.
2. Click Add New Model.
3. Choose the credential you created earlier.
4. Enter the model name you want to expose, for example:

```text
gemini/gemini-3.1-pro-preview
```

5. Set the provider to Gemini.
6. Use your Gemini API key in the credential or provider configuration.
7. Save the model.

You can also use a friendly alias such as:

```text
gemini-3.1-pro-preview
```

Make sure the model is connected to your Gemini provider using the credential you created.

### Virtual key
1. Inside the LiteLLM UI, create a new virtual key.
2. Choose the credential you just created.
3. Set the permissions needed for the backend.
4. Generate the key.
5. Copy the generated key into the backend environment:

```env
LITELLM_VIRTUAL_KEY=your_virtual_key_here
```

## 6. Set the backend environment values

Update the backend environment file with:

```text
gemini/gemini-3.1-pro-preview
```

Or configure a friendly alias such as:

```text
gemini-3.1-pro-preview
```

Make sure the model is connected to your Gemini provider using the Gemini API key.

## 6. Set the backend environment values

Update the backend environment file with:

```env
AI_PROVIDER=litellm
LITELLM_PROXY_URL=http://localhost:17002
LITELLM_VIRTUAL_KEY=your_virtual_key_here
LITELLM_MODEL=gemini/gemini-3.1-pro-preview
```

If you use a different model name in the UI, set `LITELLM_MODEL` to the same value.

## 7. What happens after this

Once the backend starts with these values:

1. The app sends requests to the LiteLLM proxy.
2. LiteLLM uses the virtual key for authentication.
3. LiteLLM sends the request to Gemini using the configured model.
4. The response comes back to the backend.

## 8. Windows checklist

- [ ] Docker Desktop is running
- [ ] LiteLLM container is running
- [ ] The LiteLLM UI opens in the browser
- [ ] Master key is created
- [ ] Virtual key is created
- [ ] Gemini model is added in the UI
- [ ] Backend env file contains the proxy URL, virtual key, and model name

## 9. Quick test

After saving the configuration, restart the backend and test the flow. If everything is correct, the backend should be able to call Gemini through LiteLLM without needing to use the Gemini key directly in the app code.
