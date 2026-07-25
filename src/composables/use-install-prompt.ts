import { onBeforeUnmount, onMounted, ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const installEvent = ref<BeforeInstallPromptEvent | null>(null)
  const installed = ref(false)

  function handlePrompt(event: Event) {
    event.preventDefault()
    installEvent.value = event as BeforeInstallPromptEvent
  }

  function handleInstalled() {
    installEvent.value = null
    installed.value = true
  }

  async function install() {
    if (!installEvent.value) return false
    await installEvent.value.prompt()
    const choice = await installEvent.value.userChoice
    if (choice.outcome === 'accepted') installEvent.value = null
    return choice.outcome === 'accepted'
  }

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeinstallprompt', handlePrompt)
    window.removeEventListener('appinstalled', handleInstalled)
  })

  return {
    canInstall: installEvent,
    installed,
    install,
  }
}
