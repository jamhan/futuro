package com.futuro.exchange.events;

import com.fasterxml.jackson.databind.ObjectMapper;
import net.openhft.chronicle.queue.ChronicleQueue;
import net.openhft.chronicle.queue.ExcerptAppender;
import net.openhft.chronicle.queue.ExcerptTailer;
import net.openhft.chronicle.queue.impl.single.SingleChronicleQueueBuilder;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.File;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Event bus implementation using Chronicle Queue.
 * 
 * Provides append-only, immutable event log with full replayability.
 * All state mutations must originate from events published here.
 */
@Component
public class EventBus {
    private static final String QUEUE_PATH = "chronicle-data/events";
    
    private ChronicleQueue queue;
    private ExcerptAppender appender;
    private final ObjectMapper objectMapper;
    
    private final List<Consumer<Event>> subscribers = new ArrayList<>();
    
    public EventBus(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }
    
    @PostConstruct
    public void init() {
        // Create directory if it doesn't exist
        File queueDir = new File(QUEUE_PATH);
        queueDir.mkdirs();
        
        // Build Chronicle Queue
        queue = SingleChronicleQueueBuilder
                .binary(Paths.get(QUEUE_PATH))
                .build();
        
        appender = queue.acquireAppender();
    }
    
    @PreDestroy
    public void cleanup() {
        if (queue != null) {
            queue.close();
        }
    }
    
    /**
     * Publish an event to the event log.
     * This is the only way to mutate system state.
     */
    public void publish(Event event) {
        try {
            // Serialize event to JSON
            String json = objectMapper.writeValueAsString(event);
            
            // Append to Chronicle Queue
            appender.writeText(json);
            
            // Notify subscribers
            for (Consumer<Event> subscriber : subscribers) {
                subscriber.accept(event);
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to publish event", e);
        }
    }
    
    /**
     * Subscribe to events.
     */
    public void subscribe(Consumer<Event> subscriber) {
        subscribers.add(subscriber);
    }
    
    /**
     * Replay all events from the beginning.
     */
    public void replayAll(Consumer<Event> handler) {
        try {
            ExcerptTailer tailer = queue.createTailer();
            
            while (true) {
                String json = tailer.readText();
                if (json == null) {
                    break;
                }
                
                Event event = objectMapper.readValue(json, Event.class);
                handler.accept(event);
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to replay events", e);
        }
    }
    
    /**
     * Replay events from a specific timestamp.
     */
    public void replayFrom(Instant fromTimestamp, Consumer<Event> handler) {
        try {
            ExcerptTailer tailer = queue.createTailer();
            
            while (true) {
                String json = tailer.readText();
                if (json == null) {
                    break;
                }
                
                Event event = objectMapper.readValue(json, Event.class);
                if (event.getTimestamp().isAfter(fromTimestamp) || 
                    event.getTimestamp().equals(fromTimestamp)) {
                    handler.accept(event);
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to replay events from timestamp", e);
        }
    }
}


