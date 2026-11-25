// Central capability registry for Mlimani's multi-provider AI platform.
// This reports configuration and integration readiness only; it never exposes secrets.
const providerDefinitions = [
  { id: 'liveavatar', name: 'LiveAvatar', services: ['live_avatar', 'live_call', 'avatar_library'], key: 'LIVEAVATAR_API_KEY', integration: 'active', description: 'Live avatars, real-time calls and avatar catalog.' },
  { id: 'pollinations', name: 'Pollinations', services: ['image_generation', 'video_generation'], key: 'POLLINATIONS_API_KEY', integration: 'active', description: 'Current short-video generation adapter.' },
  { id: 'openrouter-video', name: 'OpenRouter Video', services: ['video_generation'], key: 'OPENROUTER_API_KEY', integration: 'active', description: 'Asynchronous video generation adapter; model pricing may apply.' },
  { id: 'openrouter-chat', name: 'OpenRouter', services: ['chat', 'text_generation'], key: 'OPENROUTER_API_KEY', integration: 'active', description: 'Text and chat model routing.' },
  { id: 'elevenlabs', name: 'ElevenLabs', services: ['music_generation'], key: 'ELEVENLABS_API_KEY', integration: 'active', description: 'Music generation adapter is available in Mlimani Studio.' },
  { id: 'cartesia', name: 'Cartesia', services: ['voice_generation'], key: 'CARTESIA_API_KEY', integration: 'active', description: 'Text-to-speech adapter is available; a valid voice ID and approved price are required.' },
  { id: 'deepgram', name: 'Deepgram', services: ['speech_to_text', 'speech_recognition'], key: 'DEEPGRAM_API_KEY', integration: 'active', description: 'Pre-recorded audio transcription adapter is available; language support must be verified per account/model.' },
  { id: 'replicate', name: 'Replicate', services: ['animation'], key: 'REPLICATE_API_TOKEN', integration: 'planned', description: 'Animation and model-based image generation integration planned.' },
  { id: 'stability', name: 'Stability AI', services: ['image_generation', 'image_editing'], key: 'STABILITY_API_KEY', integration: 'active', description: 'Stable Image Core generation adapter is available; an approved per-image price is required.' },
  { id: 'runway', name: 'Runway', services: ['video_generation', 'motion'], key: 'RUNWAY_API_KEY', integration: 'active', description: 'Text-to-video and motion task adapter is available; Admin-approved pricing is required.' },
  { id: 'luma', name: 'Luma', services: ['video_generation', 'motion'], key: 'LUMA_AGENTS_API_KEY', integration: 'active', description: 'Ray video generation and motion task adapter is available; Admin-approved pricing is required.' },
  { id: 'heygen', name: 'HeyGen', services: ['avatar_video', 'avatar_library'], key: 'HEYGEN_API_KEY', integration: 'active', description: 'Avatar and talking-photo video adapter plus avatar/voice catalog are available; Admin-approved pricing is required.' },
  { id: 'did', name: 'D-ID', services: ['avatar_video', 'talking_photo'], key: 'DID_API_KEY', integration: 'planned', description: 'Talking-photo provider integration planned.' }
];

const serviceDefinitions = [
  { id: 'live_call', name: 'Live Call', description: 'Real-time avatar conversations' },
  { id: 'avatar_library', name: 'Avatar Library', description: 'Browse and select AI presenters' },
  { id: 'voice_generation', name: 'Voice Studio', description: 'Create spoken audio and voiceovers' },
  { id: 'music_generation', name: 'Music Studio', description: 'Generate original music and instrumental tracks' },
  { id: 'speech_to_text', name: 'Speech Recognition', description: 'Convert speech into text' },
  { id: 'video_generation', name: 'Video Studio', description: 'Generate short videos and adverts' },
  { id: 'image_generation', name: 'Image Studio', description: 'Create and edit images' },
  { id: 'animation', name: 'Animation Studio', description: 'Cartoon and animated content' },
  { id: 'motion', name: 'Motion Studio', description: 'Motion and camera movement tools' },
  { id: 'chat', name: 'AI Chat', description: 'Text and assistant models' }
];

export function buildAiProviderCatalog(env = process.env) {
  const videoChoice = String(env.VIDEO_PROVIDER || 'pollinations').toLowerCase();
  const configured = providerDefinitions.map(provider => {
    const credentialConfigured = Boolean(env[provider.key]);
    const selected = provider.id === 'pollinations' && videoChoice === 'pollinations'
      || provider.id === 'openrouter-video' && videoChoice === 'openrouter'
      || ['liveavatar', 'elevenlabs', 'cartesia', 'deepgram', 'stability', 'heygen', 'openrouter-chat'].includes(provider.id)
      || provider.id === 'runway' && String(env.STUDIO_MOTION_PROVIDER || 'runway').toLowerCase() === 'runway'
      || provider.id === 'luma' && String(env.STUDIO_MOTION_PROVIDER || 'runway').toLowerCase() === 'luma';
    const ready = provider.integration === 'active' && credentialConfigured;
    return {
      id: provider.id,
      name: provider.name,
      services: provider.services,
      credentialConfigured,
      credentialName: provider.key,
      integrationStatus: provider.integration,
      ready,
      selected: Boolean(selected && ready),
      description: provider.description
    };
  });
  const services = serviceDefinitions.map(service => {
    const providers = configured.filter(provider => provider.services.includes(service.id));
    const readyProviders = providers.filter(provider => provider.ready);
    return {
      ...service,
      providers,
      available: readyProviders.length > 0,
      activeProviderIds: readyProviders.filter(provider => provider.selected).map(provider => provider.id)
    };
  });
  return {
    platform: 'Mlimani AI',
    architecture: 'multi-provider',
    generatedAt: new Date().toISOString(),
    services,
    providers: configured,
    note: 'CredentialConfigured means a key exists. Planned integrations are not callable until their adapters are implemented and tested.'
  };
}
