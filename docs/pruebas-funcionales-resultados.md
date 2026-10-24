# Resultados de las pruebas funcionales de integración

Ejecutadas el 2026-10-24 con `scripts/pruebas-funcionales.ts` contra http://localhost:3100, base PostgreSQL local y servicio de ML local.

**48 de 48 casos aprobados.**

| Caso | Requisito | Técnica | Qué se verifica | Resultado | Tiempo (ms) | Detalle |
|---|---|---|---|---|---|---|
| PF-01 | Ley 25.326, art. 6 | Funcional (API) | El registro sin aceptar el tratamiento de datos se rechaza | Aprobado | 88 |  |
| PF-02 | RF001, RF002 | Funcional (API) | Registro de una organización: crea la organización y deja a la persona como Administrador | Aprobado | 1000 |  |
| PF-03 | Seguridad | Funcional (API) | Un email repetido se rechaza (409) sin crear una segunda cuenta | Aprobado | 399 |  |
| PF-04 | Seguridad | Funcional (API) | Una contraseña de menos de 8 caracteres se rechaza | Aprobado | 128 |  |
| PF-05 | Seguridad | Funcional (API) | Inicio de sesión: la contraseña incorrecta no abre sesión y la correcta sí | Aprobado | 964 |  |
| PF-06 | Seguridad | Funcional (API) | Sin sesión, los datos y las escrituras responden 401 | Aprobado | 41 |  |
| PF-07 | Seguridad | Prueba de robustez | Un intento de inyección SQL en el email del inicio de sesión no rompe nada ni abre sesión | Aprobado | 77 |  |
| PF-08 | RF003, RF005, RF008 | Funcional (API) | Crear una cadena desde la plantilla lineal: 5 nodos de 5 tipos y 4 aristas con tránsito > 0 | Aprobado | 131 | 131 ms |
| PF-09 | RF012, RF013 | Funcional (API + base) | Cada nodo nace con 28 semanas de historial, con línea base, banda y déficit nunca negativo | Aprobado | 12 |  |
| PF-10 | RF014 | Funcional (API + base) | La línea base de un nodo está congelada: es la misma en todas sus semanas | Aprobado | 8 |  |
| PF-11 | RF007 | Funcional (API) | La capacidad de producción solo se acepta en una Fábrica y la de almacenamiento solo en un Almacén | Aprobado | 286 |  |
| PF-12 | RF008 | Funcional (API) | El tiempo de tránsito de una arista se edita y debe ser mayor que cero; la arista no tiene costo | Aprobado | 194 |  |
| PF-13 | Modelo de datos | Funcional (API) | Una arista de un nodo consigo mismo y una arista repetida se rechazan | Aprobado | 143 |  |
| PF-14 | Modelo de datos | Funcional (API) | Un nodo con aristas no se puede eliminar hasta desconectarlo | Aprobado | 82 |  |
| PF-15 | RF034 | Funcional (API) | Plan Freemium: se puede llegar a 6 nodos y el séptimo se rechaza con plan_limit | Aprobado | 223 |  |
| PF-16 | RF034 | Funcional (API) | No hay tope de cadenas: una segunda cadena en blanco se crea, pero una plantilla que no entra en el plan se rechaza | Aprobado | 160 |  |
| PF-17 | RF034, RF035 | Funcional (API) | Un downgrade que deja a la organización por encima de los topes se rechaza (plan_overage); un upgrade se acepta | Aprobado | 336 |  |
| PF-18 | RF002 | Funcional (API) | Invitar a una persona como Operador y aceptar la invitación con su cuenta | Aprobado | 2608 |  |
| PF-19 | RF002 | Funcional (API) | El Operador no puede editar la red, invitar ni cambiar roles | Aprobado | 168 |  |
| PF-20 | RF002, HU3 | Funcional (API) | El Operador sí puede crear una simulación | Aprobado | 67 |  |
| PF-21 | RF002 | Funcional (API) | El Administrador cambia el rol de otra persona (con efecto inmediato) y no puede cambiarse el suyo | Aprobado | 535 |  |
| PF-22 | RNF03, RF001 | Funcional (API) | Otra organización no ve ni modifica los datos de la primera: todo responde 404 | Aprobado | 560 |  |
| PF-23 | RNF03 | Funcional (API) | Una cadena privada solo la ve quien la creó, aunque sea de la misma organización | Aprobado | 372 |  |
| PF-24 | RF002 | Funcional (API) | Quitar a una persona de la organización: pierde el acceso y los datos compartidos quedan | Aprobado | 251 |  |
| PF-25 | RF009, RF010 | Funcional (API + base) | Ingesta de envíos: 3 envíos de una semana nueva se agregan en una fila con la media y la línea base congelada | Aprobado | 206 |  |
| PF-26 | RF009, RF010 | Funcional (API) | No se aceptan envíos de una semana que ya está registrada (409 stale_week) | Aprobado | 130 |  |
| PF-27 | RF006, RF014 | Funcional (API) | El monitoreo vivo agrega una semana por nodo y no toca la historia ni la línea base | Aprobado | 138 | 134 ms |
| PF-28 | RF006 | Funcional (API) | Reiniciar el monitoreo vuelve a las 28 semanas originales | Aprobado | 163 |  |
| PF-29 | RF018, HU1, HU2 | Funcional (API + detector) | Una degradación sostenida (4 márgenes por debajo durante 8 semanas) se confirma, con desde cuándo y déficit acumulado | Aprobado | 1041 | desde 2026-10-19, 8 semanas, déficit 44.2 d |
| PF-30 | HU1 | Funcional (API + detector) | Un desvío aislado de una sola semana (1 margen) no dispara alerta | Aprobado | 407 |  |
| PF-31 | RF019, HU1 | Funcional (API + detector) | La sensibilidad configurable cambia el resultado: dos semanas a 1,5 márgenes se confirman con 'Máxima' y no con 'Baja' | Aprobado | 539 |  |
| PF-32 | RF011, HU2 | Funcional (API + detector) | El listado de alertas muestra la degradación vigente del nodo y no muestra a los nodos sanos | Aprobado | 17 |  |
| PF-33 | RNF02, HU3 | Funcional (API) | Crear una simulación con un evento responde 202 enseguida y la corrida termina en segundo plano | Aprobado | 136 | respuesta 42 ms, corrida lista en 94 ms |
| PF-34 | RF029, RF028 | Funcional (API + base) | La tabla k informa mediana y rango por fracción de propagación, y 'no cruza' como nulo, nunca como número | Aprobado | 1 |  |
| PF-35 | RF030 | Funcional (API) | Volver a correr con reconfiguración agrega una corrida nueva y no pisa la anterior | Aprobado | 178 |  |
| PF-36 | RF022, RF025 | Funcional (API) | La semana de reconfiguración fuera del horizonte se rechaza | Aprobado | 83 |  |
| PF-37 | RF026, Flujo B | Funcional (API) | Una simulación con dos eventos (de un nodo o de dos) se rechaza: es un evento por simulación | Aprobado | 113 |  |
| PF-38 | RF025, RF026 | Funcional (API) | Entradas inválidas: horizonte fuera de rango, magnitud > 100 % y nodo de otra cadena se rechazan | Aprobado | 182 |  |
| PF-39 | RF024 | Funcional (base) | El modelo de datos no tiene ninguna columna monetaria (resultados, eventos, escenarios, aristas) | Aprobado | 8 |  |
| PF-40 | RF034 | Funcional (API) | Tope de escenarios guardados: en Freemium el cuarto escenario se rechaza (plan_limit) | Aprobado | 2464 |  |
| PF-41 | RF030 | Funcional (API + base) | Eliminar una simulación borra sus eventos y todas sus corridas | Aprobado | 91 |  |
| PF-42 | Robustez de la simulación en segundo plano | Prueba de robustez | Una corrida que quedó 'corriendo' por más de 6 minutos (función perdida) se descarta y se informa como fallida | Aprobado | 1695 |  |
| PF-43 | Cuenta | Funcional (API) | Cambio de nombre y de contraseña: la contraseña actual es obligatoria y la nueva funciona | Aprobado | 3070 |  |
| PF-44 | RF032 | Funcional (API + base) | Eliminar la cuenta pide la contraseña; si es la única persona de la organización, se borra todo lo suyo | Aprobado | 1804 |  |
| PF-45 | RF032 | Funcional (API) | La única administradora con más integrantes no puede eliminar su cuenta (409), y puede después de ceder el rol | Aprobado | 3179 |  |
| PF-48 | RNF01 | Prueba de carga | Una simulación sobre una red de 100 nodos y 52 semanas termina en menos de 5 s (entorno local, app en modo desarrollo) | Aprobado | 16805 | 100 nodos, 160 aristas, 52 semanas: 191 ms hasta tener el resultado |
| PF-46 | RF015, RF016 | Integración | Con el servicio de ML activo, las líneas base de los nodos nuevos salen del modelo ('ml') y traen banda semanal | Aprobado | 1499 |  |
| PF-47 | Tolerancia a fallas del servicio de ML (4.2) | Integración | Con el servicio de ML caído, el sistema sigue operando con una línea base provisoria marcada como tal | Aprobado | 1878 | cadena creada en 1065 ms |

Tiempos medidos: crearCadena 131 ms, avance 134 ms, respuesta202 42 ms, corrida 94 ms, carga100nodos 191 ms, sinMl 1065 ms.
