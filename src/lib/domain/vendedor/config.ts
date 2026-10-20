// Interruptor del camino de datos REALES para el nodo Vendedor (vendedor de Olist en días + línea base del modelo).
//
// Decisión del proyecto: ningún nodo usa datos reales. En una instalación real cada nodo recibiría su historial de
// sensores IoT; como no existen, el generador de `lib/domain/synthetic` los simula, en la misma métrica que mide el
// modelo de ML (días de margen de despacho), y el modelo estima la línea base y las bandas de cada nodo a partir de
// ese historial (`ingestion/vendedor-setup.ts`, `prepareSensorBaselines`). Olist entrena y evalúa el modelo y calibra
// los perfiles del generador; no alimenta los nodos.
//
// El camino real (`lib/domain/vendedor`) queda en el código pero inactivo: las cadenas que ya tengan Vendedores reales
// siguen funcionando, y reactivarlo es poner esto en `true`. No hay otro lugar donde se decida.
export const REAL_VENDEDORES_ENABLED = false;
