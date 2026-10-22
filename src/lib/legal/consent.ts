// Información previa al registro y consentimiento para el tratamiento de los datos personales (art. 6 de la Ley 25.326:
// finalidad, destinatarios, carácter obligatorio, consecuencias y derechos).
//
// Contacto para consultas y responsables del archivo: los datos del equipo del proyecto.

/** Email al que se pueden dirigir las consultas sobre los datos personales (y los pedidos de cambio de email). */
export const CONSENT_CONTACT_EMAIL = "fsena@uade.edu.ar";

/** Responsables del archivo de datos: nombres y domicilio o correo. */
export const CONSENT_RESPONSIBLES = "Facundo Guevara y Federico Sena (fsena@uade.edu.ar)";

export const CONSENT_TITLE = "Antes de crear tu cuenta";

export const CONSENT_CHECKBOX_LABEL = "Leí esta información y acepto el tratamiento de mis datos para esos fines.";

export const CONSENT_REQUIRED_MESSAGE = "Para crear la cuenta tenés que aceptar el tratamiento de tus datos";

export const CONSENT_PARAGRAPHS = [
  "TwinChain es un prototipo académico desarrollado como Proyecto Final de Ingeniería en la Universidad Argentina de la Empresa (UADE). Para crear tu cuenta pedimos tu nombre, tu email y una contraseña (y el nombre de tu organización, si te registrás como organización). Los usamos solo para identificarte, iniciar tu sesión y vincularte con tu organización. No se ceden a terceros; los aloja la base de datos del sistema (Neon) y los procesa el servidor (Vercel). Todos estos datos son obligatorios: sin ellos no podemos crear la cuenta.",
  `Tenés derecho a acceder a tus datos, rectificarlos y suprimirlos. Podés corregir tu nombre y tu contraseña, y eliminar tu cuenta y tus datos (nombre, email y contraseña), desde la sección Cuenta. Para consultar tus datos o cambiar tu email, escribinos a ${CONSENT_CONTACT_EMAIL}. Responsables del archivo: ${CONSENT_RESPONSIBLES}.`,
] as const;
