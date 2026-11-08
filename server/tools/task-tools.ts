import { z } from 'zod'
import { getActiveMembers } from '../services/bank-service'
import {
  changeTaskStatus,
  createTask,
  createTaskSchema,
  discardTask,
  getTaskWithMedia,
  listTasks,
  updateTask,
  updateTaskSchema
} from '../services/task-service'
import { defineTool } from './types'

// Herramientas de tareas (fase 4). El borrado definitivo NO se expone (fase 8: solo web); aquí
// «eliminar» significa descartar (papelera).

export const taskTools = [
  defineTool({
    name: 'listar_tareas',
    description: 'Lista las tareas no descartadas con su estado, prioridad, asignado y fecha límite.',
    kind: 'read',
    inputSchema: z.object({}),
    handler: async () => {
      const [tasks, members] = await Promise.all([listTasks(), getActiveMembers()])
      const nameById = new Map(members.map(member => [member.id, member.name]))
      return {
        tareas: tasks.map(task => ({
          id: task.id,
          titulo: task.title,
          estado: task.status,
          prioridad: task.priority,
          asignadaA: task.assigneeId ? nameById.get(task.assigneeId) ?? task.assigneeId : null,
          asignadaAId: task.assigneeId,
          fechaLimite: task.dueDate,
          descripcion: task.description
        }))
      }
    }
  }),

  defineTool({
    name: 'ver_tarea',
    description: 'Detalle de una tarea con sus fotos adjuntas.',
    kind: 'read',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (_actor, input) => {
      const { task, media } = await getTaskWithMedia(input.id)
      return {
        id: task.id,
        titulo: task.title,
        descripcion: task.description,
        estado: task.status,
        prioridad: task.priority,
        fechaLimite: task.dueDate,
        descartada: task.discardedAt !== null,
        fotos: media.length
      }
    }
  }),

  defineTool({
    name: 'crear_tarea',
    description: 'Crea una tarea y, si se asigna a alguien, le envía un aviso.',
    kind: 'write',
    inputSchema: createTaskSchema,
    handler: async (actor, input) => {
      const task = await createTask({ actor, ...input })
      return { tareaId: task.id, titulo: task.title, estado: task.status }
    }
  }),

  defineTool({
    name: 'editar_tarea',
    description: 'Cambia título, descripción, persona asignada, fecha límite o prioridad de una tarea.',
    kind: 'write',
    inputSchema: updateTaskSchema.extend({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const { id, ...changes } = input
      const task = await updateTask({ actor, taskId: id, ...changes })
      return { tareaId: task.id, titulo: task.title }
    }
  }),

  defineTool({
    name: 'cambiar_estado_tarea',
    description: 'Mueve una tarea entre «todo», «in_progress» y «done».',
    kind: 'write',
    inputSchema: z.object({
      id: z.string().uuid(),
      estado: z.enum(['todo', 'in_progress', 'done'])
    }),
    handler: async (actor, input) => {
      const task = await changeTaskStatus({ actor, taskId: input.id, status: input.estado })
      return { tareaId: task.id, estado: task.status }
    }
  }),

  defineTool({
    name: 'eliminar_tarea',
    description: 'Descarta una tarea (va a la papelera del Admin, no se borra). Solo el Admin o quien la creó.',
    kind: 'destructive',
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async (actor, input) => {
      const task = await discardTask({ actor, taskId: input.id })
      return { tareaId: task.id, descartada: true }
    }
  })
]
