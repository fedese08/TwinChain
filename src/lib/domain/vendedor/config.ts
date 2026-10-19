// Interruptor del camino de datos REALES para el nodo Vendedor.
//
// Decisión del proyecto: todos los nodos se alimentan con el generador sintético (`lib/domain/synthetic`), incluido
// el Vendedor; Olist es la fuente de calibración y del modelo de ML, no de los nodos. Con el interruptor apagado
// los Vendedores nuevos nacen sintéticos (escala 0–100) como los demás tipos.
//
// El camino real (vendedor de Olist en días + línea base del modelo, `lib/domain/vendedor`) queda en el código pero
// inactivo: las cadenas que ya tienen Vendedores reales siguen funcionando, y si se quisiera reactivarlo basta
// poner esto en `true`. No hay otro lugar donde se decida.
export const REAL_VENDEDORES_ENABLED = false;
