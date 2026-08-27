/**
 * The Spanish catalogue, and the source of the key type.
 *
 * Every other catalogue is typed against this one, so a key added here without
 * a translation elsewhere fails the typecheck rather than reaching a screen.
 *
 * Keys are flat and dotted, which keeps them greppable: finding where a string
 * is used is a search for the literal key.
 *
 * Brand names are NOT here. "Nomey" is the same word in every language, and
 * putting it in a catalogue would invite someone to translate it.
 */
export const esES = {
  'brand.signature': 'by LCWorks',

  'nav.home': 'Inicio',
  'nav.groups': 'Grupos',
  'nav.notifications': 'Notificaciones',
  'nav.profile': 'Perfil',

  'scope.personal': 'Personal',
  'scope.couple': 'Pareja',
  'scope.label': 'Ámbito',
  'scope.switchTo': 'Cambiar a {scope}',

  'action.addTo': 'Añadir a {scope}',
  'action.addToGroups': 'Añadir a un grupo',
  'action.close': 'Cerrar',
  'action.soon': 'Próximamente',
  'action.retry': 'Reintentar',
  'action.cancel': 'Cancelar',
  'action.save': 'Guardar',

  'auth.signInTitle': 'Entrar',
  'auth.signInSubtitle': 'Bienvenido de vuelta.',
  'auth.signUpTitle': 'Crear cuenta',
  'auth.signUpSubtitle': 'Empieza a ordenar tu dinero.',
  'auth.name': 'Nombre',
  'auth.namePlaceholder': 'Cómo quieres que te llamemos',
  'auth.email': 'Email',
  'auth.emailPlaceholder': 'tu@email.com',
  'auth.password': 'Contraseña',
  'auth.passwordPlaceholder': 'Tu contraseña',
  'auth.signInAction': 'Entrar',
  'auth.signUpAction': 'Crear cuenta',
  'auth.toSignUp': '¿No tienes cuenta? Créala',
  'auth.toSignIn': '¿Ya tienes cuenta? Entra',
  'auth.working': 'Un momento…',
  'auth.missingFields': 'Rellena todos los campos.',

  'auth.checkEmailTitle': 'Revisa tu correo',
  'auth.checkEmailBody': 'Te hemos enviado un enlace de confirmación a {email}.',
  'auth.checkEmailStep': 'Confírmalo y vuelve aquí para entrar con tu contraseña.',
  'auth.checkEmailBack': 'Volver a entrar',

  'authError.invalidCredentials': 'Email o contraseña incorrectos.',
  'authError.emailNotConfirmed': 'Todavía no has confirmado tu email. Revisa tu correo.',
  'authError.accountUnavailable': 'Esta cuenta no está disponible.',
  'authError.weakPassword': 'Esa contraseña no cumple los requisitos.',
  'authError.invalidEmail': 'Ese email no parece válido.',
  'authError.rateLimited': 'Demasiados intentos. Espera un momento.',
  'authError.signUpDisabled': 'El registro no está disponible ahora mismo.',
  'authError.checkYourEmail': 'Revisa tu correo para continuar.',
  'authError.nameRequired': 'Escribe un nombre.',
  'authError.network': 'Sin conexión. Inténtalo de nuevo.',
  'authError.generic': 'Algo ha ido mal. Inténtalo de nuevo.',

  'session.unavailableTitle': 'No hemos podido comprobar tu sesión',
  'session.unavailableBody': 'Puede ser cosa de la conexión. Inténtalo de nuevo.',

  'home.greeting': 'Hola, {name}',
  'home.greetingPlain': 'Hola',
  'state.loading': 'Cargando…',
  'state.errorTitle': 'No se ha podido cargar',
  'state.errorBody': 'Vuelve a intentarlo en un momento.',
  'state.retry': 'Reintentar',

  'home.available': 'Disponible',
  'home.activity': 'Actividad reciente',
  'home.activityEmpty': 'Todavía no hay movimientos.',
  'home.activityHint': 'Usa el botón de añadir para registrar el primero.',

  'groups.title': 'Grupos',
  'groups.empty': 'Todavía no tienes grupos.',
  'groups.emptyHint': 'Aquí aparecerán los viajes, pisos y gastos compartidos.',
  'groups.create': 'Crear grupo',

  'notifications.empty': 'No hay notificaciones.',
  'notifications.emptyHint': 'Los avisos de tus grupos aparecerán aquí.',

  'account.details': 'Tus datos',
  'account.name': 'Nombre',
  'account.noName': 'Sin nombre',
  'account.email': 'Email',
  'account.noEmail': 'Sin email',
  'account.session': 'Sesión',
  'account.signOut': 'Cerrar sesión',
  'account.signOutHint': 'Se cerrará la sesión en este dispositivo.',
  'account.signOutConfirmTitle': '¿Cerrar sesión?',
  'account.signOutConfirmBody': 'Podrás volver a entrar con tu cuenta cuando quieras.',
  'account.signOutBusy': 'Cerrando sesión…',
  'account.forgetLocal': 'Cerrar sesión solo en este dispositivo',
  'account.forgetLocalHint':
    'Borra la sesión de este teléfono aunque no hayamos podido avisar al servidor. Seguirá activa allí hasta que caduque.',

  'profile.account': 'Cuenta',
  'profile.appearance': 'Apariencia',
  'profile.diagnostics': 'Diagnóstico',
  'profile.general': 'General',
  'profile.languageCurrency': 'Idioma y divisa',
  'profile.shortcuts': 'Atajos',
  'profile.plans': 'Planes y suscripciones',
  'profile.plansTitle': 'Nomey, completo',
  'profile.plansBody': 'Aquí podrás ver y gestionar tu plan cuando esté disponible.',
  'profile.addPhoto': 'Añadir foto de perfil',
  'profile.photoSoonTitle': 'Foto de perfil',
  'profile.photoSoonBody': 'Todavía no puedes subir una foto. Llegará más adelante.',
  'profile.editName': 'Editar nombre',

  'dev.states': 'Estados comunes',
  'dev.statesHint': 'Solo en desarrollo. Sirve para comprobarlos en el dispositivo.',
  'dev.sessionProbe': 'Sonda de sesión',

  'probe.hint': 'Comprueba en el dispositivo lo que Vitest no puede comprobar.',
  'probe.secureStore': 'SecureStore disponible',
  'probe.largeValue': 'Valor grande, ida y vuelta',
  'probe.cleared': 'Borrado completo',
  'probe.client': 'Cliente Supabase creado',
  'probe.session': 'La sesión responde sin error',
  'probe.payload': 'Payload real de la sesión',
  'probe.run': 'Ejecutar',
  'probe.rerun': 'Repetir',

  'foundation.caption': 'Base visual',
  'foundation.palette': 'Paleta',
  'foundation.typography': 'Tipografía',
  'foundation.formatting': 'Formato',
  'foundation.runtime': 'Intl en este dispositivo',

  'locale.label': 'Idioma',
  'locale.preference': 'Preferencia',
  'locale.automatic': 'Automático',
  'locale.device': 'Idioma del sistema',
  'locale.region': 'Región del sistema',
  'locale.catalogue': 'Catálogo activo',
  'locale.formatting': 'Formato regional',

  'runtime.available': 'Disponible',
  'runtime.missing': 'No disponible',
  'runtime.fallbackOk': 'Ausente · fallback OK',
  'runtime.exactPath': 'Ruta exacta: {path}',

  'sample.income': 'Ingreso',
  'sample.expense': 'Gasto',
  'sample.large': 'Importe grande',
} as const;

export type MessageKey = keyof typeof esES;
