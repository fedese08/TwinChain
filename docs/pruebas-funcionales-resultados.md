# Resultados de las pruebas funcionales de integración

Ejecutadas el 2026-10-24 con `scripts/pruebas-funcionales.ts` contra http://localhost:3100, base PostgreSQL local y servicio de ML local.

**48 de 48 casos aprobados.**

| Caso | Requisito | Técnica | Qué se verifica | Resultado | Tiempo (ms) | Detalle |
|---|---|---|---|---|---|---|
| PF-01 | RF001, art. 6 Ley 25.326 | Funcional (API) | El registro sin aceptar el tratamiento de datos se rechaza | Aprobado | 67 |  |
| PF-02 | RF001, RF002 | Funcional (API) | Registro de una organización: crea la organización y deja a la persona como Administrador | Aprobado | 900 |  |
| PF-03 | Seguridad | Funcional (API) | Un email repetido se rechaza (409) sin crear una segunda cuenta | Aprobado | 375 |  |
| PF-04 | Seguridad | Funcional (API) | Una contraseña de menos de 8 caracteres se rechaza | Aprobado | 21 |  |
| PF-05 | Seguridad | Funcional (API) | Inicio de sesión: la contraseña incorrecta no abre sesión y la correcta sí | Aprobado | 996 |  |
| PF-06 | Seguridad | Funcional (API) | Sin sesión, los datos y las escrituras responden 401 | Aprobado | 35 |  |
| PF-07 | Seguridad | Prueba de robustez | Un intento de inyección SQL en el email del inicio de sesión no rompe nada ni abre sesión | Aprobado | 74 |  |
| PF-08 | RF003, RF005, RF008 | Funcional (API) | Crear una cadena desde la plantilla lineal: 5 nodos de 5 tipos y 4 aristas con tránsito > 0 | Aprobado | 116 | 116 ms |
| PF-09 | RF012, RF013 | Funcional (API + base) | Cada nodo nace con 28 semanas de historial, con línea base, banda y déficit nunca negativo | Aprobado | 11 |  |
| PF-10 | RF014 | Funcional (API + base) | La línea base de un nodo está congelada: es la misma en todas sus semanas | Aprobado | 11 |  |
| PF-11 | RF007 | Funcional (API) | La capacidad de producción solo se acepta en una Fábrica y la de almacenamiento solo en un Almacén | Aprobado | 230 |  |
| PF-12 | RF008 | Funcional (API) | El tiempo de tránsito de una arista se edita y debe ser mayor que cero; la arista no tiene costo | Aprobado | 176 |  |
| PF-13 | Modelo de datos | Funcional (API) | Una arista de un nodo consigo mismo y una arista repetida se rechazan | Aprobado | 164 |  |
| PF-14 | Modelo de datos | Funcional (API) | Un nodo con aristas no se puede eliminar hasta desconectarlo | Aprobado | 80 |  |
| PF-15 | Planes (modelo de negocio) | Funcional (API) | Plan Freemium: se puede llegar a 6 nodos y el séptimo se rechaza con plan_limit | Aprobado | 332 |  |
| PF-16 | Planes | Funcional (API) | No hay tope de cadenas: una segunda cadena en blanco se crea, pero una plantilla que no entra en el plan se rechaza | Aprobado | 153 |  |
| PF-17 | Planes | Funcional (API) | Un downgrade que deja a la organización por encima de los topes se rechaza (plan_overage); un upgrade se acepta | Aprobado | 290 |  |
| PF-18 | RF002, casos de uso | Funcional (API) | Invitar a una persona como Operador y aceptar la invitación con su cuenta | Aprobado | 2576 |  |
| PF-19 | RF002 | Funcional (API) | El Operador no puede editar la red, invitar ni cambiar roles | Aprobado | 306 |  |
| PF-20 | RF002, Flujo B | Funcional (API) | El Operador sí puede crear una simulación | Aprobado | 55 |  |
| PF-21 | Casos de uso (Administrador) | Funcional (API) | El Administrador cambia el rol de otra persona (con efecto inmediato) y no puede cambiarse el suyo | Aprobado | 431 |  |
| PF-22 | Multi-tenant (RF001) | Funcional (API) | Otra organización no ve ni modifica los datos de la primera: todo responde 404 | Aprobado | 510 |  |
| PF-23 | Multi-tenant | Funcional (API) | Una cadena privada solo la ve quien la creó, aunque sea de la misma organización | Aprobado | 144 |  |
| PF-24 | Gestión de integrantes | Funcional (API) | Quitar a una persona de la organización: pierde el acceso y los datos compartidos quedan | Aprobado | 173 |  |
| PF-25 | RF009, RF010 | Funcional (API + base) | Ingesta de envíos: 3 envíos de una semana nueva se agregan en una fila con la media y la línea base congelada | Aprobado | 187 |  |
| PF-26 | RF011 | Funcional (API) | No se aceptan envíos de una semana que ya está registrada (409 stale_week) | Aprobado | 88 |  |
| PF-27 | RF009 | Funcional (API) | El monitoreo vivo agrega una semana por nodo y no toca la historia ni la línea base | Aprobado | 147 | 145 ms |
| PF-28 | RF014 | Funcional (API) | Reiniciar el monitoreo vuelve a las 28 semanas originales | Aprobado | 84 |  |
| PF-29 | RF018, HU1, HU2 | Funcional (API + detector) | Una degradación sostenida (4 márgenes por debajo durante 8 semanas) se confirma, con desde cuándo y déficit acumulado | Aprobado | 981 | desde 2026-10-19, 8 semanas, déficit 53.2 d |
| PF-30 | HU1 | Funcional (API + detector) | Un desvío aislado de una sola semana (1 margen) no dispara alerta | Aprobado | 328 |  |
| PF-31 | RF019, HU1 | Funcional (API + detector) | La sensibilidad configurable cambia el resultado: dos semanas a 1,5 márgenes se confirman con 'Máxima' y no con 'Baja' | Aprobado | 766 |  |
| PF-32 | HU3, listado de alertas | Funcional (API + detector) | El listado de alertas muestra la degradación vigente del nodo y no muestra a los nodos sanos | Aprobado | 14 |  |
| PF-33 | Flujo B, C36 | Funcional (API) | Crear una simulación con un evento responde 202 enseguida y la corrida termina en segundo plano | Aprobado | 142 | respuesta 40 ms, corrida lista en 102 ms |
| PF-34 | RF029, RF028 | Funcional (API + base) | La tabla k informa mediana y rango por fracción de propagación, y 'no cruza' como nulo, nunca como número | Aprobado | 1 |  |
| PF-35 | RF030 | Funcional (API) | Volver a correr con reconfiguración agrega una corrida nueva y no pisa la anterior | Aprobado | 273 |  |
| PF-36 | RF022 | Funcional (API) | La semana de reconfiguración fuera del horizonte se rechaza | Aprobado | 69 |  |
| PF-37 | Flujo B (un evento) | Funcional (API) | Una simulación con dos eventos (de un nodo o de dos) se rechaza: es un evento por simulación | Aprobado | 114 |  |
| PF-38 | RF025, RF026 | Funcional (API) | Entradas inválidas: horizonte fuera de rango, magnitud > 100 % y nodo de otra cadena se rechazan | Aprobado | 224 |  |
| PF-39 | RF024 | Funcional (base) | El modelo de datos no tiene ninguna columna monetaria (resultados, eventos, escenarios, aristas) | Aprobado | 3 |  |
| PF-40 | Planes | Funcional (API) | Tope de escenarios guardados: en Freemium el cuarto escenario se rechaza (plan_limit) | Aprobado | 1944 |  |
| PF-41 | RF030 | Funcional (API + base) | Eliminar una simulación borra sus eventos y todas sus corridas | Aprobado | 100 |  |
| PF-42 | Robustez del job | Prueba de robustez | Una corrida que quedó 'corriendo' por más de 6 minutos (función perdida) se descarta y se informa como fallida | Aprobado | 1567 |  |
| PF-43 | Cuenta | Funcional (API) | Cambio de nombre y de contraseña: la contraseña actual es obligatoria y la nueva funciona | Aprobado | 3106 |  |
| PF-44 | RF032 | Funcional (API + base) | Eliminar la cuenta pide la contraseña; si es la única persona de la organización, se borra todo lo suyo | Aprobado | 1889 |  |
| PF-45 | RF032 | Funcional (API) | La única administradora con más integrantes no puede eliminar su cuenta (409), y puede después de ceder el rol | Aprobado | 3193 |  |
| PF-48 | RNF de desempeño | Prueba de carga | Una simulación sobre una red de 100 nodos y 52 semanas termina en menos de 5 s (entorno local, app en modo desarrollo) | Aprobado | 11624 | 100 nodos, 160 aristas, 52 semanas: 217 ms hasta tener el resultado |
| PF-46 | RF015, RF016 | Integración | Con el servicio de ML activo, las líneas base de los nodos nuevos salen del modelo ('ml') y traen banda semanal | Aprobado | 1378 |  |
| PF-47 | Disponibilidad (RNF) | Integración | Con el servicio de ML caído, el sistema sigue operando con una línea base provisoria marcada como tal | Aprobado | 1933 | cadena creada en 1110 ms |

Tiempos medidos: crearCadena 116 ms, avance 145 ms, respuesta202 40 ms, corrida 102 ms, carga100nodos 217 ms, sinMl 1110 ms.
